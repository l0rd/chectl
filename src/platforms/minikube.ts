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

import { Command } from '@oclif/command'
import * as commandExists from 'command-exists'
import * as execa from 'execa'
import * as Listr from 'listr'

export class MinikubeHelper {
  startTasks(flags: any, command: Command): Listr {
    return new Listr([
      {
        title: 'Verify if kubectl is installed',
        task: () => {
          if (!commandExists.sync('kubectl')) {
            command.error('E_REQUISITE_NOT_FOUND')
          }
        }
      },
      { title: 'Verify if minikube is installed',
        task: () => {
          if (!commandExists.sync('minikube')) {
            command.error('E_REQUISITE_NOT_FOUND', { code: 'E_REQUISITE_NOT_FOUND' })
          }
        }
      },
      { title: 'Verify if minikube is running',
        task: async () => {
          try {
            const minikubeIsRunning = await this.isMinikubeRunning()
            if (!minikubeIsRunning) {
              command.error(`minikube is not running
To start minikube run the following command:
  minikube start --memory=4096 --cpus=4 --disk-size=50g
error: E_PLATFORM_NOT_READY`)
            }
          } catch (e) {
            command.error(e.message)
          }
        }
      },
      // { title: 'Verify minikube memory configuration', skip: () => 'Not implemented yet', task: () => {}},
      // { title: 'Verify kubernetes version', skip: () => 'Not implemented yet', task: () => {}},
      { title: 'Verify if minikube ingress addon is enabled',
        task: async (ctx: any) => {
          ctx.isIngressAddonEnabled = await this.isIngressAddonEnabled()
        }
      },
      { title: 'Enable minikube ingress addon',
        skip: (ctx: any) => {
          if (ctx.isIngressAddonEnabled) {
            return 'Ingress addon is already enabled.'
          }
        },
        task: () => this.enableIngressAddon()
      },
      { title: 'Retrieving minikube IP and domain for ingress URLs',
        enabled: () => flags.domain !== undefined,
        task: async (_ctx: any, task: any) => {
          const ip = await this.getMinikubeIP()
          flags.domain = ip + '.nip.io'
          task.title = `${task.title}...${flags.domain}.`
        }
      },
    ])
  }

  async isMinikubeRunning(execTimeout = 60000): Promise<boolean> {
    const { cmd, code, stderr, stdout, timedOut } =
                        await execa('minikube', ['status'], { timeout: execTimeout, reject: false })
    if (timedOut) {
      throw new Error(`Command "${cmd}" timed out after ${execTimeout}ms
stderr: ${stderr}
stdout: ${stdout}
error: E_TIMEOUT`)
    }
    if (code === 0) { return true } else { return false }
  }

  async startMinikube(execTimeout = 180000) {
    const { cmd, code, stderr, stdout, timedOut } =
                        await execa('minikube', ['start', '--memory=4096', '--cpus=4', '--disk-size=50g'], { timeout: execTimeout, reject: false})
    if (timedOut) {
      throw new Error(`Command "${cmd}" timed out after ${execTimeout}ms
stderr: ${stderr}
stdout: ${stdout}
error: E_TIMEOUT`)
    }
    if (code === 0) {
      throw new Error(`Command "${cmd}" failed with return code ${code}
stderr: ${stderr}
stdout: ${stdout}
error: E_COMMAND_FAILED`)
    }
  }

  async isIngressAddonEnabled(): Promise<boolean> {
    const { stdout } = await execa('minikube', ['addons', 'list'], { timeout: 60000 })
    if (stdout.includes('ingress: enabled')) { return true } else { return false }
  }

  async enableIngressAddon() {
    await execa('minikube', ['addons', 'enable', 'ingress'], { timeout: 60000 })
  }

  async getMinikubeIP(): Promise<string> {
    const { stdout } = await execa('minikube', ['ip'], { timeout: 60000 })
    return stdout
  }
}
