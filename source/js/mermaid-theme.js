/* global mermaid */
// 按 Keep 主题的亮暗模式给 mermaid 上色，并在切换时重绘
;(() => {
  const mermaidLib = window.mermaid
  if (!mermaidLib) return

  // mermaid 默认在 window.load 时用自带主题渲染一遍，这里拦下来自己接管
  mermaidLib.startOnLoad = false

  const sources = new Map()
  let hasRendered = false

  const readColor = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
  }

  const buildVariables = () => {
    const primary = readColor('--primary-color', '#2ed573')
    const background = readColor('--background-color-1', '#ffffff')
    const surface = readColor('--background-color-2', '#f6f6f6')
    const surfaceDeep = readColor('--background-color-3', surface)
    const content = readColor('--content-background-color', background)
    const text = readColor('--text-color-1', '#4c4948')
    const textSoft = readColor('--text-color-3', '#858585')
    const border = readColor('--border-color', '#e3e3e3')

    return {
      darkMode: document.documentElement.classList.contains('dark-mode'),
      background: surface,
      mainBkg: content,
      primaryColor: content,
      primaryTextColor: text,
      primaryBorderColor: primary,
      secondaryColor: surfaceDeep,
      tertiaryColor: surface,
      nodeBorder: primary,
      lineColor: textSoft,
      textColor: text,
      titleColor: text,
      edgeLabelBackground: surface,
      clusterBkg: content,
      clusterBorder: border,
      noteBkgColor: surfaceDeep,
      noteTextColor: text,
      noteBorderColor: border,
      stateLabelColor: text,
      labelTextColor: text,
      fontFamily: getComputedStyle(document.body).fontFamily
    }
  }

  const applyTheme = () => {
    mermaidLib.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'base',
      themeVariables: buildVariables(),
      flowchart: { useMaxWidth: true },
      sequence: { useMaxWidth: true }
    })
  }

  // 先把源文本存下来，重绘时才有东西可以还原
  const collect = () => {
    document.querySelectorAll('.keep-markdown-body .mermaid').forEach((node) => {
      if (!sources.has(node)) sources.set(node, node.innerHTML)
    })
  }

  const render = async () => {
    if (sources.size === 0) return

    applyTheme()

    sources.forEach((source, node) => {
      node.removeAttribute('data-processed')
      node.innerHTML = source
    })

    await mermaidLib.run({ querySelector: '.keep-markdown-body .mermaid' })
    hasRendered = true
  }

  collect()
  applyTheme()

  window.addEventListener('load', () => {
    render().catch((error) => console.error('[mermaid] render failed', error))
  })

  // 亮暗切换只改 html 的 class，盯这里就够了
  let pending = false
  const observer = new MutationObserver(() => {
    if (!hasRendered || pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      render().catch((error) => console.error('[mermaid] re-render failed', error))
    })
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})()
