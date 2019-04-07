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

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'

export default class Stop extends Command {
  static description = 'stop Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
    'deployment-name': string({
      description: 'Che deployment name',
      default: 'che',
      env: 'CHE_DEPLOYMENT'
    }),
    'che-selector': string({
      description: 'Selector for Che Server resources',
      default: 'app=che',
      env: 'CHE_SELECTOR'
    }),
    'access-token': string({
      description: 'Che OIDC Access Token',
      env: 'CHE_ACCESS_TOKEN'
    }),
    'listr-renderer': string({
      description: 'Listr renderer. Can be \'default\', \'silent\' or \'verbose\'',
      default: 'default'
    })
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const che = new CheHelper()
    const kh = new KubeHelper()
    const oc = new OpenShiftHelper()
    let tasks = new Listr([
      {
        title: 'Verify Kubernetes API',
        task: async (ctx: any, task: any) => {
          try {
            await kh.checkKubeApi()
            ctx.isOpenShift = await kh.isOpenShift()
            task.title = await `${task.title}...done`
            if (ctx.isOpenShift) {
              task.title = await `${task.title} (it's OpenShift)`
            }
          } catch (error) {
            this.error(`Failed to connect to Kubernetes API. ${error.message}`)
          }
        }
      },
    ], {renderer: flags['listr-renderer'] as any})

    tasks.add(che.installCheckTasks(flags, this))

    tasks.add([{
      title: 'Deployment Config doesn\'t exist',
      enabled: (ctx: any) => (!ctx.cheDeploymentExist && !ctx.cheDeploymentConfigExist),
      task: async () => {
        await this.error(`E_BAD_DEPLOY - Deployment and DeploymentConfig do not exist.\nNeither a Deployment nor a DeploymentConfig named "${flags['deployment-name']}" exist in namespace \"${flags.chenamespace}\", Che Server cannot be stopped.\nFix with: verify the namespace where Che is running (oc get projects)\nhttps://github.com/eclipse/che`, {code: 'E_BAD_DEPLOY'})
      }
    },
    {
      title: 'Che server was already stopped',
      enabled: (ctx: any) => (ctx.isStopped),
      task: async () => {}
    },
    {
      title: 'Che server Pod is not ready. It may be failing to start. Skipping shutdown request',
      enabled: (ctx: any) => (ctx.isNotReadyYet),
      task: async () => {}
    },
    {
      title: 'Stop Che server and wait until it\'s ready to shutdown',
      enabled: (ctx: any) => !ctx.isStopped && !ctx.isNotReadyYet,
      task: async (ctx: any, task: any) => {
        if (ctx.isAuthEnabled && !flags['access-token']) {
          this.error('E_AUTH_REQUIRED - Che authentication is enabled and an access token need to be provided (flag --access-token).\nFor instructions to retreive a valid access token refer to https://www.eclipse.org/che/docs/che-6/authentication.html')
        }
        try {
          const cheURL = await che.cheURL(flags.chenamespace)
          await che.startShutdown(cheURL, flags['access-token'])
          await che.waitUntilReadyToShutdown(cheURL)
          task.title = await `${task.title}...done`
        } catch (error) {
          this.error(`E_SHUTDOWN_CHE_SERVER_FAIL - Failed to shutdown Che server. ${error.message}`)
        }
      }
    },
    {
      title: `Scale  \"${flags['deployment-name']}\"  deployment to zero`,
      enabled: (ctx: any) => !ctx.isStopped,
      task: async (ctx: any, task: any) => {
        try {
          if (ctx.cheDeploymentConfigExist) {
            await oc.scaleDeploymentConfig(flags['deployment-name'], flags.chenamespace, 0)
          } else {
            await kh.scaleDeployment(flags['deployment-name'], flags.chenamespace, 0)
          }
          task.title = await `${task.title}...done`
        } catch (error) {
          this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale deployment. ${error.message}`)
        }
      }
    },
    {
      title: 'Wait until Che pod is deleted',
      enabled: (ctx: any) => !ctx.isStopped,
      task: async (_ctx: any, task: any) => {
        await kh.waitUntilPodIsDeleted('app=che', flags.chenamespace)
        task.title = `${task.title}...done.`
      }
    },
    {
      title: 'Scale  \"keycloak\"  deployment to zero',
      enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
      task: async (ctx: any, task: any) => {
        try {
          if (ctx.cheDeploymentConfigExist) {
            await oc.scaleDeploymentConfig('keycloak', flags.chenamespace, 0)
          } else {
            await kh.scaleDeployment('keycloak', flags.chenamespace, 0)
          }
          task.title = await `${task.title}...done`
        } catch (error) {
          this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale keycloak deployment. ${error.message}`)
        }
      }
    },
    {
      title: 'Wait until Keycloak pod is deleted',
      enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
      task: async (_ctx: any, task: any) => {
        await kh.waitUntilPodIsDeleted('app=keycloak', flags.chenamespace)
        task.title = `${task.title}...done.`
      }
    },
    {
      title: 'Scale  \"postgres\"  deployment to zero',
      enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
      task: async (ctx: any, task: any) => {
        try {
          if (ctx.cheDeploymentConfigExist) {
            await oc.scaleDeploymentConfig('postgres', flags.chenamespace, 0)
          } else {
            await kh.scaleDeployment('postgres', flags.chenamespace, 0)
          }
          task.title = await `${task.title}...done`
        } catch (error) {
          this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale postgres deployment. ${error.message}`)
        }
      }
    },
    {
      title: 'Wait until Postgres pod is deleted',
      enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
      task: async (_ctx: any, task: any) => {
        await kh.waitUntilPodIsDeleted('app=postgres', flags.chenamespace)
        task.title = `${task.title}...done.`
      }
    }])

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:stop has completed.'
    })

    this.exit(0)
  }
}
