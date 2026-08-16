#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter } from 'node:path';

const target = process.argv[2];
if (!['android', 'ios'].includes(target)) throw new Error('Usage: node scripts/mobile-targets.mjs <android|ios>');
if (target === 'android' && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) throw new Error('Android SDK is required. Set ANDROID_HOME or ANDROID_SDK_ROOT before running this command.');
if (target === 'ios' && !existsSync('/Applications/Xcode.app')) throw new Error('Xcode is required to initialize the iOS target.');

const toolPaths = ['/opt/homebrew/bin', '/usr/local/bin'].filter(existsSync);
const env = { ...process.env, PATH: [...toolPaths, process.env.PATH].filter(Boolean).join(delimiter) };
execFileSync('npx', ['tauri', target, 'init', '--ci'], { stdio: 'inherit', env });
