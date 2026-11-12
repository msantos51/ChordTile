import { Composition } from 'remotion';
import { Short, SHORT_FRAMES } from './Short';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/roboto/latin-900.css';
import '@fontsource/roboto-mono/latin-500.css';

export const Root = () => (
  <Composition id="Short" component={Short} durationInFrames={SHORT_FRAMES} fps={30} width={1080} height={1920} />
);
