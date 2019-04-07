/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { HelmHelper } from '../../installers/helm'
import { MinishiftAddonHelper } from '../../installers/minishift-addon'
import { OperatorHelper } from '../../installers/operator'
import { MinikubeHelper } from '../../platforms/minikube'
import { MinishiftHelper } from '../../platforms/minishift'
export default class Start extends Command {
  static description = 'start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
    cheimage: string({
      char: 'i',
      description: 'Che server container image',
      default: 'eclipse/che-server:nightly',
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default:  Start.getTemplatesDir(),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    }),
    'listr-renderer': string({
      description: 'Listr renderer. Can be \'default\', \'silent\' or \'verbose\'',
      default: 'default'
    }),
    multiuser: flags.boolean({
      char: 'm',
      description: 'Starts che in multi-user mode',
      default: false
    }),
    tls: flags.boolean({
      char: 's',
      description: 'Enable TLS encryption and multi-user mode',
      default: false
    }),
    installer: string({
      char: 'a',
      description: 'Installer type. Valid values are \"helm\", \"operator\" and \"minishift-addon\"',
      default: ''
    }),
    domain: string({
      char: 'b',
      description: 'Domain of the Kubernetes/OpenShift cluster (e.g. starter-us-east-2.openshiftapps.com or <local-ip>.nip.io)',
      default: ''
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\".',
      default: 'minikube'
    }),
    'deployment-name': string({
      description: 'Che deployment name',
      default: 'che',
      env: 'CHE_DEPLOYMENT'
    }),
  }

  static getTemplatesDir(): string {
    // return local templates folder if present
    const TEMPLATES = 'templates'
    const templatesDir = path.resolve(TEMPLATES)
    const exists = fs.pathExistsSync(templatesDir)
    if (exists) {
      return TEMPLATES
    }
    // else use the location from modules
    return path.join(__dirname, '../../../../chectl/templates')
  }

  static setPlaformDefaults(flags: any) {
    if (flags.platform === 'minishift') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'minishift-addon'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'minikube') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'helm'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    }
  }

  async run() {
    const { flags } = this.parse(Start)
    Start.setPlaformDefaults(flags)
    const minikube = new MinikubeHelper()
    const minishift = new MinishiftHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const operator = new OperatorHelper()
    const kube = new KubeHelper()
    const os = new OpenShiftHelper()
    const minishiftAddon = new MinishiftAddonHelper()

    let cheDeploymentExist = false
    let keycloakDeploymentExist = false
    let postgresDeploymentExist = false
    let cheIsAlreadyRunning = false

    // Platform Checks
    let platformCheckTasks = new Listr(undefined, {renderer: flags['listr-renderer'] as any, collapse: false})
    if (flags.platform === 'minikube') {
      platformCheckTasks.add({
        title: '✈️  Minikube preflight checklist',
        task: () => minikube.startTasks(flags, this)
      })
    } else if (flags.platform === 'minishift') {
      platformCheckTasks.add({
        title: '✈️  Minishift preflight checklist',
        task: () => minishift.startTasks(flags, this)
      })
    } else {
      this.error(`Platformm ${flags.platform} is not supported yet ¯\\_(ツ)_/¯`)
      this.exit()
    }

    // Checks if Che is already deployed
    let preInstallSubTasks = new Listr()
    const preInstallTasks = new Listr([{
      title: '👀  Looking for an already existing Che instance',
      task: () => preInstallSubTasks
    }], {
      renderer: flags['listr-renderer'] as any,
      collapse: false
    })
    preInstallSubTasks.add(che.installCheckTasks(flags, this))
    preInstallSubTasks.add([
      {
        title: 'Scaling up Che Deployment',
        enabled: (ctx: any) => ctx.cheDeploymentExist && ctx.isStopped,
        task: async (ctx: any, task: any) => {
          cheDeploymentExist = true
          if (ctx.postgresDeploymentExist) {
            postgresDeploymentExist = true
            await kube.scaleDeployment('postgres', flags.chenamespace, 1)
          }
          if (ctx.keycloakDeploymentExist) {
            keycloakDeploymentExist = true
            await kube.scaleDeployment('keycloak', flags.chenamespace, 1)
          }
          await kube.scaleDeployment(flags['deployment-name'], flags.chenamespace, 1)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'Scaling up Che DeploymentConfig',
        enabled: (ctx: any) => ctx.cheDeploymentConfigExist && ctx.isStopped,
        task: async (ctx: any, task: any) => {
          cheDeploymentExist = true
          if (ctx.postgresDeploymentExist) {
            postgresDeploymentExist = true
            await os.scaleDeploymentConfig('postgres', flags.chenamespace, 1)
          }
          if (ctx.keycloakDeploymentExist) {
            keycloakDeploymentExist = true
            await os.scaleDeploymentConfig('keycloak', flags.chenamespace, 1)
          }
          await os.scaleDeploymentConfig(flags['deployment-name'], flags.chenamespace, 1)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: `Che is already running in namespace \"${flags.chenamespace}\".`,
        enabled: (ctx: any) => ((ctx.cheDeploymentExist || ctx.cheDeploymentConfigExist) && !ctx.isStopped),
        task: async (ctx: any, task: any) => {
          cheDeploymentExist = true
          cheIsAlreadyRunning = true
          ctx.cheURL = await che.cheURL(flags.chenamespace)
          task.title = await `${task.title}...it's URL is ${ctx.cheURL}`
        }
      }
    ])

    // Installer
    let installerTasks = new Listr({renderer: flags['listr-renderer'] as any, collapse: false})
    if (flags.installer === 'helm') {
      installerTasks.add({
        title: '🏃‍  Running Helm to install Che',
        task: () => helm.startTasks(flags, this)
      })
    } else if (flags.installer === 'operator') {
      // The operator installs Che multiuser only
      flags.multiuser = true
      // Installers use distinct ingress names
      installerTasks.add({
        title: '🏃‍  Running the Che Operator',
        task: () => operator.startTasks(flags, this)
      })
    } else if (flags.installer === 'minishift-addon') {
      // minishift-addon supports Che singleuser only
      flags.multiuser = false
      // Installers use distinct ingress names
      installerTasks.add({
        title: '🏃‍  Running the Che minishift-addon',
        task: () => minishiftAddon.startTasks(flags)
      })
    } else {
      this.error(`Installer ${flags.installer} is not supported ¯\\_(ツ)_/¯`)
      this.exit()
    }

    // Post Install Checks
    let postInstallSubTasks = new Listr()
    const postInstallTasks = new Listr([{
      title: '🙈  Post installation checklist',
      task: () => postInstallSubTasks
    }], {
      renderer: flags['listr-renderer'] as any,
      collapse: false
    })

    postInstallSubTasks.add({
      enabled: () => (flags.multiuser || postgresDeploymentExist),
      title: 'PostgreSQL pod bootstrap',
      task: () => this.podStartTasks('app=postgres', flags.chenamespace)
    })

    postInstallSubTasks.add({
      enabled: () => (flags.multiuser || keycloakDeploymentExist),
      title: 'Keycloak pod bootstrap',
      task: () => this.podStartTasks('app=keycloak', flags.chenamespace)
    })

    postInstallSubTasks.add({
      title: 'Che pod bootstrap',
      task: () => this.podStartTasks('app=che', flags.chenamespace)
    })

    postInstallSubTasks.add({
      title: 'Retrieving Che Server URL',
      task: async (ctx: any, task: any) => {
        ctx.cheURL = await che.cheURL(flags.chenamespace)
        task.title = await `${task.title}...${ctx.cheURL}`
      }
    })

    postInstallSubTasks.add({
      title: 'Che status check',
      task: async ctx => che.isCheServerReady(ctx.cheURL, flags.chenamespace)
    })

    try {
      await platformCheckTasks.run()
      await preInstallTasks.run()
      if (!cheIsAlreadyRunning && !cheDeploymentExist) {
        await installerTasks.run()
      }
      if (!cheIsAlreadyRunning) {
        await postInstallTasks.run()
      }
      this.log('Command server:start has completed successfully.')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }

  podStartTasks(selector: string, namespace = ''): Listr {
    const kube = new KubeHelper()
    return new Listr([
      {
        title: 'scheduling',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodPending(selector, namespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'downloading images',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodPhase(selector, 'Running', namespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'starting',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodReady(selector, namespace)
          task.title = `${task.title}...done.`
        }
      }
    ])
  }
}
