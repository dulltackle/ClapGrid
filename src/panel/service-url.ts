/** 绑定放在页面路径中，各聊天面板互不覆盖，不使用跨标签共享 cookie。 */
export function panelServiceUrl() {
  return `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
}
