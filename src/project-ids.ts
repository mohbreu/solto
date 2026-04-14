export function envKeyFor(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`Invalid project id "${id}": must match /^[a-z0-9-]+$/`);
  }
  return id.toUpperCase().replace(/-/g, "_");
}
