import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/base.less'
import { installRendererRuntimeEnv } from './services/app/rendererRuntimeEnv'
import { applyThemeToDocument } from './services/app/themeRuntime'
import { installUiFocusCoordinator } from './services/app/uiFocusCoordinator'

installRendererRuntimeEnv()
installUiFocusCoordinator()
// 配置水合发生在 onMounted 之后的异步 IPC,首帧前先按系统外观同步注入完整主题变量,
// 避免模块层级变量缺失导致的首帧闪烁;水合完成后会用用户配置的主题覆盖。
applyThemeToDocument('auto')
const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
