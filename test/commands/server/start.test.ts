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
import {expect, test} from '@oclif/test'

describe('sever:start', () => {
  test
    .stdout()
    .command(['server:start'])
    .it('starts Che Server', ctx => {
      expect(ctx.stdout).to.contain('Successfully started')
    })
})
