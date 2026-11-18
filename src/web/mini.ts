const BAR = 52

export const shrinkWhenScrolledPast = (viewer: HTMLElement): void => {
  const watcher = new IntersectionObserver(([entry]) => {
    if (!viewer.isConnected) {
      watcher.disconnect()
      return
    }
    if (entry === undefined) return
    const past = !entry.isIntersecting && entry.boundingClientRect.top < BAR
    if (past === viewer.classList.contains("mini")) return
    // The shrunk player leaves the flow, and the page under it jumps unless the viewer keeps its height.
    viewer.style.minHeight = past ? `${viewer.offsetHeight}px` : ""
    viewer.classList.toggle("mini", past)
  }, { rootMargin: `-${BAR}px 0px 0px 0px` })
  watcher.observe(viewer)
  viewer.querySelector(".stage")?.addEventListener("click", () => {
    if (!viewer.classList.contains("mini")) return
    viewer.classList.remove("mini")
    viewer.style.minHeight = ""
    viewer.scrollIntoView({ block: "start" })
  })
}
