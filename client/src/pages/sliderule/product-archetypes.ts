/**
 * 产品原型账本的前端投影。合法域只从同一份 JSON 派生，
 * 不许再手抄 desktop|phone 或业务原型名。
 *
 * 加设备 / 接通原型 = 只改 slide-rule-python/services/data/product_archetypes.json。
 */
import archetypes from "@archetypes";

type Ledger = {
  defaultArchetype?: string;
  archetypes?: Record<
    string,
    { label?: string; wired?: boolean }
  >;
  deviceForms?: {
    defaultDevice?: string;
    judgeSentinel?: string;
    forms?: Record<
      string,
      { label?: string; wired?: boolean }
    >;
  };
};

const LEDGER = archetypes as Ledger;

export function defaultArchetype(): string {
  return String(LEDGER.defaultArchetype || "business_app");
}

export function defaultDevice(): string {
  return String(LEDGER.deviceForms?.defaultDevice || "desktop");
}

export function judgeSentinel(): string {
  return String(LEDGER.deviceForms?.judgeSentinel || "unspecified");
}

export function wiredArchetypes(): Array<{ id: string; label: string }> {
  const rows = LEDGER.archetypes || {};
  return Object.entries(rows)
    .filter(([, spec]) => spec?.wired === true)
    .map(([id, spec]) => ({ id, label: String(spec.label || id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function allDeviceForms(): Array<{
  id: string;
  label: string;
  wired: boolean;
}> {
  const forms = LEDGER.deviceForms?.forms || {};
  return Object.entries(forms).map(([id, spec]) => ({
    id,
    label: String(spec.label || id),
    wired: spec?.wired === true,
  }));
}

export function wiredDevices(): Array<{ id: string; label: string }> {
  return allDeviceForms()
    .filter(row => row.wired)
    .map(({ id, label }) => ({ id, label }));
}

export function wiredDeviceIds(): string[] {
  return wiredDevices().map(row => row.id);
}

export function isWiredDevice(name: string | null | undefined): boolean {
  return Boolean(name) && wiredDeviceIds().includes(String(name));
}

export function isWiredArchetype(name: string | null | undefined): boolean {
  return wiredArchetypes().some(row => row.id === name);
}

export function parseJudgeDevice(raw: unknown): string {
  const value = String(raw || "").trim();
  if (isWiredDevice(value) || value === judgeSentinel()) return value;
  return judgeSentinel();
}

export function parsePreferredDevice(raw: unknown): string {
  const value = String(raw || "").trim();
  return isWiredDevice(value) ? value : defaultDevice();
}

export function deviceDisplayLabel(device: string): string {
  if (device === "phone") return "手机应用";
  if (device === "desktop") return "Web / PC";
  if (device === "tablet") return "平板";
  if (device === judgeSentinel()) return "未指定（两档都生成）";
  const row = wiredDevices().find(item => item.id === device);
  return row?.label || device;
}
