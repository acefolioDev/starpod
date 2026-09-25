/** Choose the best supported response media type from an HTTP Accept header. */
export function negotiateContentType(
  request: Request,
  supported: readonly string[],
): string | undefined {
  validateSupported(supported);
  if (supported.length === 0) return undefined;

  const header = request.headers.get("accept");
  if (!header || header.trim() === "") return supported[0];

  const accepted = header.split(",").map(parseAccepted).filter(Boolean) as AcceptedType[];
  let best: { readonly type: string; readonly score: number; readonly order: number } | undefined;
  for (const [order, type] of supported.entries()) {
    const candidate = parseMediaType(type);
    const match = accepted.reduce<{ quality: number; specificity: number } | undefined>((score, item) => {
      if (!matches(candidate, item)) return score;
      const specificity = candidate === item.type ? 2 : item.type === "*/*" ? 0 : 1;
      if (!score || specificity > score.specificity) return { quality: item.quality, specificity };
      return specificity === score.specificity && item.quality > score.quality
        ? { quality: item.quality, specificity }
        : score;
    }, undefined);
    if (!match || match.quality === 0) continue;
    if (!best || match.quality > best.score || (match.quality === best.score && order < best.order)) {
      best = { type, score: match.quality, order };
    }
  }
  return best?.type;
}

type AcceptedType = { readonly type: string; readonly quality: number };

function parseAccepted(value: string): AcceptedType | undefined {
  try {
    const [rawType, ...parameters] = value.trim().split(";");
    const type = parseMediaType(rawType ?? "");
    let quality = 1;
    for (const parameter of parameters) {
      const [name, rawValue] = parameter.trim().split("=", 2);
      if (name?.toLowerCase() !== "q") continue;
      quality = Number(rawValue);
      if (!Number.isFinite(quality) || quality < 0 || quality > 1) return undefined;
    }
    return { type, quality };
  } catch {
    return undefined;
  }
}

function parseMediaType(value: string): string {
  const type = value.trim().toLowerCase();
  if (!/^(?:[!#$%&'*+.^_`|~0-9a-z-]+|\*)\/(?:[!#$%&'*+.^_`|~0-9a-z-]+|\*)$/.test(type)) {
    throw new Error(`Invalid media type: ${value}`);
  }
  return type;
}

function matches(supported: string, accepted: AcceptedType) {
  if (accepted.type === "*/*" || accepted.type === supported) return true;
  return accepted.type.endsWith("/*") && supported.startsWith(accepted.type.slice(0, -1));
}

function validateSupported(supported: readonly string[]) {
  for (const type of supported) parseMediaType(type);
}
