import { Config } from '@remotion/cli/config';

// Screen recordings, narration, music and timings all live in ../build.
Config.setPublicDir('../build');
Config.setVideoImageFormat('jpeg');
Config.setConcurrency(4);
// Use the pre-installed headless shell instead of downloading one.
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
