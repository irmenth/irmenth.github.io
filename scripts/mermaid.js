'use strict';

// 把 ```mermaid 代码块转成 mermaid 能识别的 <pre class="mermaid">，
// 避免被代码高亮器当成普通文本渲染。
hexo.extend.filter.register('before_post_render', function (data) {
  data.content = data.content.replace(
    /^```mermaid[^\n]*\r?\n([\s\S]*?)^```[ \t]*$/gm,
    function (match, code) {
      return '<pre class="mermaid">\n' + code.trimEnd() + '\n</pre>\n';
    }
  );
  return data;
}, 9);
