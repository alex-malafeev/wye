'use client';
import { useEffect, useState } from 'react';
import { FolderField } from './FolderPicker';
import type { LinkedVault } from '@/lib/vault-links';

// Settings › Links (plan:vault-links, req:waterfall.vault-links.app): the vaults this one reaches — the one above and the
// ones below by folder, and other repos by URL. A repo link is committed with the vault; where that repo is on this
// machine is kept on this machine only, found from a vault the app knows or set here. Agents ask them with
// `wye ask --vault <name>` and send them work with `wye request <name>`.
const KIND: Record<LinkedVault['kind'], string> = { parent: 'above', child: 'below', repo: 'repo' };

export function SettingsLinks({ product }: { product: string }) {
  const [vaults, setVaults] = useState<LinkedVault[] | null | undefined>(undefined);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => { fetch(`/api/${product}/vaults`).then(r => r.ok ? r.json() : null).then(j => setVaults(j ? j.vaults : null)).catch(() => setVaults(null)); }, [product]);
  const act = async (body: Record<string, string>) => {
    setBusy(true); setMsg('');
    const r = await fetch(`/api/${product}/vaults`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setMsg(`Failed: ${j.message ?? j.error ?? r.statusText}`); return false; }
    setVaults(j.vaults); return true;
  };
  const add = async () => { if (await act({ action: 'add', url: url.trim(), name: name.trim() })) { setUrl(''); setName(''); setMsg('Linked — commit .wye/_product.md to share the link'); } };
  if (vaults === null) return null;   // not a vault beside its code: nothing to link
  return (
    <section className="kind-section settings-section">
      <h2>Links</h2>
      <p className="lede">The vaults <b>{product}</b> can ask questions and send requests to. The vault above and the ones below are linked by their folders. Link another repo, a backend beside an app, by its URL. The link is committed with the vault, and where that repo is on this machine stays on this machine.</p>
      <div className="inbox-form">
        <ul className="remotes vault-links">
          {vaults && vaults.length === 0 && <li className="remote remote-none muted">No linked vaults yet.</li>}
          {(vaults ?? []).map(v => (
            <li key={`${v.kind}:${v.name}`} className={`remote s-${v.folder ? 'connected' : 'off'}`} data-link={v.name}>
              <div className="remote-row">
                <span className="remote-dot" aria-hidden="true" />
                <span className="remote-host">{v.name} <span className="muted">{KIND[v.kind]}</span></span>
                <span className="remote-state">{v.repo && <code>{v.repo}</code>} {v.folder ? <span className="muted">{v.folder}</span> : <span className="remote-why">not on this machine — clone it, or say where it is</span>}</span>
                {v.kind === 'repo' && <span className="remote-acts"><button disabled={busy} onClick={() => void act({ action: 'remove', name: v.name })}>Remove</button></span>}
              </div>
              {v.kind === 'repo' && !v.folder && (
                <div className="inbox-row">
                  <label className="settings-field" style={{ flex: 1 }}>its clone <FolderField title={`Where ${v.repo} is cloned`} value={paths[v.name] ?? ''} placeholder="the folder of a clone with a vault" onChange={x => setPaths(p => ({ ...p, [v.name]: x }))} /></label>
                  <button disabled={busy || !(paths[v.name] ?? '').trim()} onClick={() => void act({ action: 'path', name: v.name, path: (paths[v.name] ?? '').trim() })}>Set</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="inbox-row remote-add">
          <input value={url} placeholder="https://github.com/owner/repo" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="Repo URL" onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && url.trim() && !busy) void add(); }} />
          <label className="settings-field">name <input value={name} placeholder="from the URL" spellCheck={false} aria-label="Link name" onChange={e => setName(e.target.value)} /></label>
        </div>
        <div className="sec-actions">
          <button className="pri" disabled={busy || !url.trim()} onClick={() => void add()}>Link repo</button>
          {msg && <span className={msg.startsWith('Failed') ? 'notice' : 'muted'}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}
