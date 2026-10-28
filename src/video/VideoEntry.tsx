import { Button, Tooltip } from '@fluentui/react-components';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { Video20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useContext } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { historyAtom } from '../nav/navHistory.ts';
import { VideoContext, type VideoBindings } from './videoContext.ts';

function Entry({ bindings }: { readonly bindings: VideoBindings }) {
  const state = useAtomValueRawSync(bindings.service.state);
  const current = useAtomValueRawSync(historyAtom).place.id === 'video';
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  if (!state.track && state.status !== 'container') return null;
  return (
    <Tooltip content={t('place.video')} relationship="label">
      <Button
        appearance={current ? 'primary' : 'subtle'}
        className={current ? undefined : viewControls.icon}
        icon={<Video20Regular />}
        aria-label={t('place.video')}
        aria-pressed={current}
        onClick={current ? bindings.close : bindings.open}
        data-video-entry
      />
    </Tooltip>
  );
}

export function VideoEntry() {
  const bindings = useContext(VideoContext);
  return bindings ? <Entry bindings={bindings} /> : null;
}
