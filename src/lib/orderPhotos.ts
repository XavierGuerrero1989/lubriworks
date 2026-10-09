export async function compressOrderPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw new Error("Elegí una imagen de hasta 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("No se pudo abrir la imagen. Probá con JPG o PNG."));
    });
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Tu navegador no permite preparar la foto.");
    let scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const base64 = canvas
        .toDataURL("image/jpeg", Math.max(0.4, 0.8 - attempt * 0.07))
        .split(",")[1];
      if (base64.length <= 240000) return base64;
      scale *= 0.8;
    }
    throw new Error(
      "La imagen es demasiado grande para adjuntarla. Usá una foto más pequeña.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
