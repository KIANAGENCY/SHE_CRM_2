#!/usr/bin/env node
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const name = 'she-crm-infrastructure';
const version = '1.0.0';
const tools = [
  { name: 'n8n_health', description: 'Consulta el estado de salud público de n8n.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'n8n_list_workflows', description: 'Lista workflows de n8n por nombre e ID (requiere API key).', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, cursor: { type: 'string' } }, additionalProperties: false } },
  { name: 'n8n_get_workflow', description: 'Consulta un workflow de n8n por ID (requiere API key).', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false } },
  { name: 'vps_run_readonly', description: 'Ejecuta un comando de diagnóstico de solo lectura en el VPS por SSH. Se permiten comandos allowlist.', inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['uptime', 'df -h', 'free -h', 'docker ps --format {{.Names}}', 'systemctl --failed --no-pager'] } }, required: ['command'], additionalProperties: false } },
];

function result(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError };
}

function n8nUrl(path = '') {
  const base = process.env.N8N_BASE_URL || 'https://n8n.hotelexpert.mx';
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('N8N_BASE_URL debe usar HTTP o HTTPS.');
  return url;
}

async function n8nRequest(path) {
  const headers = { accept: 'application/json' };
  if (process.env.N8N_API_KEY) headers['X-N8N-API-KEY'] = process.env.N8N_API_KEY;
  else if (process.env.N8N_USERNAME && process.env.N8N_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.N8N_USERNAME}:${process.env.N8N_PASSWORD}`).toString('base64')}`;
  } else if (path.startsWith('api/')) throw new Error('Configura N8N_API_KEY o N8N_USERNAME y N8N_PASSWORD.');
  const response = await fetch(n8nUrl(path), { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n respondió HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return { status: response.status, body: text.slice(0, 500) }; }
}

function ssh(command) {
  const host = process.env.VPS_HOST;
  const user = process.env.VPS_USER;
  if (!host || !user) throw new Error('Configura VPS_HOST y VPS_USER.');
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !/^[A-Za-z0-9._-]+$/.test(user)) throw new Error('VPS_HOST o VPS_USER contiene caracteres no permitidos.');
  const port = process.env.VPS_PORT || '22';
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new Error('VPS_PORT inválido.');
  const allowed = new Set(['uptime', 'df -h', 'free -h', 'docker ps --format {{.Names}}', 'systemctl --failed --no-pager']);
  if (!allowed.has(command)) throw new Error('Comando SSH no permitido.');
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-p', port];
  if (process.env.VPS_SSH_KEY) args.push('-i', resolve(process.env.VPS_SSH_KEY));
  args.push(`${user}@${host}`, command);
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => reject(new Error(`No se pudo iniciar ssh: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve(stdout.slice(0, 12000)) : reject(new Error(`SSH terminó con código ${code}: ${stderr.slice(0, 1000)}`)));
  });
}

async function callTool(name, args = {}) {
  if (name === 'n8n_health') return n8nRequest('healthz');
  if (name === 'n8n_list_workflows') {
    const url = n8nUrl('api/v1/workflows');
    url.searchParams.set('limit', String(Math.min(100, Math.max(1, Number(args.limit) || 50))));
    if (args.cursor) url.searchParams.set('cursor', String(args.cursor));
    return n8nRequest(url.toString());
  }
  if (name === 'n8n_get_workflow') return n8nRequest(`api/v1/workflows/${encodeURIComponent(args.id)}`);
  if (name === 'vps_run_readonly') return ssh(args.command);
  throw new Error(`Herramienta desconocida: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  let message;
  try {
    message = JSON.parse(line);
    let response;
    if (message.method === 'initialize') response = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name, version } };
    else if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') continue;
    else if (message.method === 'ping') response = {};
    else if (message.method === 'tools/list') response = { tools };
    else if (message.method === 'tools/call') {
      try { response = result(await callTool(message.params?.name, message.params?.arguments)); }
      catch (error) { response = result(error.message, true); }
    } else if (message.id !== undefined) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })}\n`);
      continue;
    } else continue;
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: response })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32700, message: error.message } })}\n`);
  }
}
