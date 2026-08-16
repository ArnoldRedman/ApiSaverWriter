#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = process.argv[2];
if (!['android', 'ios'].includes(target)) throw new Error('Usage: node scripts/mobile-targets.mjs <android|ios>');
if (target === 'android' && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) throw new Error('Android SDK is required. Set ANDROID_HOME or ANDROID_SDK_ROOT before running this command.');
if (target === 'ios' && !existsSync('/Applications/Xcode.app')) throw new Error('Xcode is required to initialize the iOS target.');
execFileSync('npx', ['tauri', target, 'init', '--ci'], { stdio: 'inherit' });
