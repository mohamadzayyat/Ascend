export function typedConfirm(label, expected) {
  const value = window.prompt(`${label}\n\nType exactly:\n${expected}`)
  return value === expected
}
