export function createManifest(apiOrigin: string): chrome.runtime.ManifestV3 {
  if (!apiOrigin) throw new Error('VITE_API_ORIGIN is required');
  const parsed = new URL(apiOrigin);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw new Error('VITE_API_ORIGIN must use http://127.0.0.1');
  }
  if (apiOrigin !== parsed.origin) throw new Error('VITE_API_ORIGIN must be an origin without a path, query, or fragment');
  return {
  manifest_version: 3,
  name: 'Visual Study Assistant',
  version: '0.1.0',
  description: 'Capture the visible viewport on demand and show a concise Spanish study hint.',
  action: { default_title: 'Analyze visible study content' },
  background: { service_worker: 'service-worker.js', type: 'module' },
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+A' },
      description: 'Analyze visible study content'
    }
  },
  permissions: ['activeTab', 'scripting'],
  host_permissions: [`${parsed.origin}/*`]
  };
}
