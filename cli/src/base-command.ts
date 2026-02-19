import {Command, Flags} from '@oclif/core'
import type {AbaState} from './lib/types.js'
import {loadState, saveState} from './lib/state.js'
import {parseCliError} from './lib/errors.js'

export abstract class BaseCommand<T extends typeof Command> extends Command {
  static baseFlags = {
    json: Flags.boolean({
      description: 'output as json',
      default: false,
    }),
  }

  protected getState(): AbaState {
    return loadState()
  }

  protected setState(next: AbaState): void {
    saveState(next)
  }

  protected render(json: boolean, data: unknown, text: string): void {
    if (json) {
      this.log(
        JSON.stringify(
          data,
          (_k, v) => {
            if (typeof v === 'bigint') return v.toString()
            return v
          },
          2,
        ),
      )
      return
    }

    this.log(text)
  }

  protected override async catch(err: Error & {exitCode?: number}): Promise<never> {
    const parsed = parseCliError(err)
    const asJson = this.argv.includes('--json')

    if (asJson) {
      this.log(
        JSON.stringify(
          {
            ok: false,
            error: parsed.code,
            message: parsed.message,
            hint: parsed.hint ?? null,
            raw: parsed.raw ?? null,
          },
          null,
          2,
        ),
      )
      this.exit(1)
    }

    const lines = [`${parsed.code}: ${parsed.message}`]
    if (parsed.hint) lines.push(`hint: ${parsed.hint}`)
    console.error(lines.join('\n'))
    this.exit(1)
  }
}
