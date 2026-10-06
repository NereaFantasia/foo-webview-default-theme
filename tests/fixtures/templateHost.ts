import { TEMPLATE_DIRECTORY, answerTemplateDisk } from './templateDisk.ts';
import { installFakeHost } from './unitHost.ts';

export { TEMPLATE_DIRECTORY } from './templateDisk.ts';

/** 单测用：装一台宿主替身，并给它一个内存里的模板目录。 */
export function installTemplateHost(
  initial: Readonly<Record<string, string>> = {},
  directory = TEMPLATE_DIRECTORY,
) {
  const host = installFakeHost();
  return { host, file: host.fb.file, ...answerTemplateDisk(host, initial, directory) };
}
