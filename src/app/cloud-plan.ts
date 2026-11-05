// Nome do ficheiro de cada música no Storage da conta. Módulo puro, para poder ser testado.

/** O id da música tem espaços e "|", por isso o ficheiro usa o seu SHA-256. */
export async function storageKey(id: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
