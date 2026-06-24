#!/usr/bin/env node
import { buildCli } from './cli.js';

await buildCli().runExit(process.argv.slice(2));
