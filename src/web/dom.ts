export type Child = Node | string

export type Props = Readonly<Record<string, string | boolean | EventListener>>

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: ReadonlyArray<Child>
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (typeof value === "function") node.addEventListener(name, value)
    else if (value === true) node.setAttribute(name, "")
    else if (value !== false) node.setAttribute(name, value)
  }
  node.append(...children)
  return node
}
