// 兼容层：把 `aba policy` 主命令转发到真实实现文件，避免入口文件过重。
export {default} from './policy/index.js'
