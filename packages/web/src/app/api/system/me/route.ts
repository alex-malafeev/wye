import { NextResponse } from 'next/server';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

// GET → { name } — who the person on this machine is (git's user.name, else the account name): the name presence
// shows for them when the app runs on their own laptop, where nobody is asked (plan:collaboration names)
export async function GET() {
  let name = ''; try { name = execFileSync('git', ['config', '--global', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* no git name */ }
  if (!name) try { name = os.userInfo().username; } catch { /* none */ }
  return NextResponse.json({ name: name || 'Me' });
}
