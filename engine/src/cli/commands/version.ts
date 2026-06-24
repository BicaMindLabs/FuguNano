import { Command } from 'clipanion';

import { VERSION } from '../../index.js';

/** `fugue version` — print the engine version. */
export class VersionCommand extends Command {
  static override paths = [['version']];

  override execute(): Promise<void> {
    this.context.stdout.write(`fugue ${VERSION}\n`);
    return Promise.resolve();
  }
}
