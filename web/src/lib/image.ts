/** Reduz a foto (celulares geram imagens enormes) e devolve base64 JPEG sem o prefixo data:. */
export async function photoToBase64(file: File, maxSide = 1800): Promise<{ data: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('Não foi possível abrir a imagem.')); i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

export const readText = (file: File) => new Promise<string>((ok, err) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => err(new Error('Não foi possível ler o arquivo.')); r.readAsText(file);
});
