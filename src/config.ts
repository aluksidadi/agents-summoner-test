import { parse } from "smol-toml";
import { readFileSync } from "fs";
import { join } from "path";

export interface AgentConfig {
  name: string;
  display_name: string;
  fly_app: string;
  primary_region: string;
  vm_size: string;
  vm_memory_mb: number;
  volume_name: string;
  volume_size_gb: number;
  hermes_image_tag: string;
  hermes_model: string;
  infisical_env: string;
  infisical_path: string;
  required_secrets: string[];
}

const REQUIRED_FIELDS: (keyof AgentConfig)[] = [
  "name",
  "display_name",
  "fly_app",
  "primary_region",
  "vm_size",
  "vm_memory_mb",
  "volume_name",
  "volume_size_gb",
  "hermes_image_tag",
  "hermes_model",
  "infisical_env",
  "infisical_path",
  "required_secrets",
];

const KNOWN_KEYS = new Set<string>(REQUIRED_FIELDS);

export function loadAgentConfig(name: string): AgentConfig {
  const filePath = join(process.cwd(), "agents", `${name}.toml`);
  const label = `agents/${name}.toml`;

  let raw: Record<string, unknown>;
  try {
    const text = readFileSync(filePath, "utf-8");
    raw = parse(text) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: ${msg}`);
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`${label}: unknown key "${key}"`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in raw) || raw[field] === null || raw[field] === undefined) {
      throw new Error(`${label}: missing required field "${field}"`);
    }
  }

  const cfg = raw as unknown as AgentConfig;

  if (typeof cfg.name !== "string") throw new Error(`${label}: field "name" must be a string`);
  if (typeof cfg.display_name !== "string") throw new Error(`${label}: field "display_name" must be a string`);
  if (typeof cfg.fly_app !== "string") throw new Error(`${label}: field "fly_app" must be a string`);
  if (typeof cfg.primary_region !== "string") throw new Error(`${label}: field "primary_region" must be a string`);
  if (typeof cfg.vm_size !== "string") throw new Error(`${label}: field "vm_size" must be a string`);
  if (typeof cfg.vm_memory_mb !== "number") throw new Error(`${label}: field "vm_memory_mb" must be a number`);
  if (typeof cfg.volume_name !== "string") throw new Error(`${label}: field "volume_name" must be a string`);
  if (typeof cfg.volume_size_gb !== "number") throw new Error(`${label}: field "volume_size_gb" must be a number`);
  if (typeof cfg.hermes_image_tag !== "string") throw new Error(`${label}: field "hermes_image_tag" must be a string`);
  if (typeof cfg.hermes_model !== "string") throw new Error(`${label}: field "hermes_model" must be a string`);
  if (typeof cfg.infisical_env !== "string") throw new Error(`${label}: field "infisical_env" must be a string`);
  if (typeof cfg.infisical_path !== "string") throw new Error(`${label}: field "infisical_path" must be a string`);
  if (!Array.isArray(cfg.required_secrets) || !cfg.required_secrets.every((s) => typeof s === "string")) {
    throw new Error(`${label}: field "required_secrets" must be an array of strings`);
  }

  return cfg;
}
