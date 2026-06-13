# Knowledge Base

The Knowledge Base tree manages folders, documents, and other files through the backend knowledge bridge.

- Use `新建文档` to create a Markdown document. The new document opens immediately in the main workspace and then enters inline rename.
- Tree rows show a compact type label: `文件夹`, `文档`, or `文件`.
- Drag a file or folder onto a folder to move it there. Drop onto blank tree space to move it to the root. Moving into itself or one of its own descendants is blocked before the backend move call.
- Markdown documents support `源码` and `渲染` modes. Rendering uses the editor preview pipeline for Markdown tables, code highlighting, Mermaid, local knowledge images, and sanitized HTML.
- Markdown content auto-saves through the knowledge backend after edits. There is no visible save button for routine editing; backend failures keep the editor dirty and show the backend error.
- Knowledge tabs are first-class main workspace tabs. They can be split together with shell panes by context-menu split actions or by dragging tabs onto tabs/panes, and can be restored by dropping back onto the tab bar empty area.
