// Módulos extras: ficam DESLIGADOS por padrão para o sistema ficar simples no dia a dia.
// Quem instala liga no arquivo .env, por exemplo:  MODULOS_EXTRAS=fichas,estoque_completo
//   fichas            → fichas técnicas, baixa automática de ingredientes e alerta de lucro por tamanho
//   estoque_completo  → custo médio, valor em estoque, categorias, fornecedores e tela de saídas detalhada
export interface Modules { fichas: boolean; estoqueCompleto: boolean }

export function modulesFromEnv(env: Record<string, string | undefined> = process.env): Modules {
  const list = String(env.MODULOS_EXTRAS ?? '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
  const all = list.includes('todos');
  return { fichas: all || list.includes('fichas'), estoqueCompleto: all || list.includes('estoque_completo') };
}
