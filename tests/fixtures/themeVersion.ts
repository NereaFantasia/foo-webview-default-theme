import metadata from '../../package.json' with { type: 'json' };

/** 被测应用自己的版本即包版本；下一版取次版本加一，必然比它新。 */
export const CURRENT_VERSION = metadata.version;
export const NEXT_VERSION = CURRENT_VERSION.replace(
  /^(\d+)\.(\d+)\..*$/,
  (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`,
);
