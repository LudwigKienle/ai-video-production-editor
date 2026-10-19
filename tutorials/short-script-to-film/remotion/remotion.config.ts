import { Config } from '@remotion/cli/config';

// Clips, stills and sounds are cut into ../build by scripts/prep.mjs.
Config.setPublicDir('../build');
Config.setVideoImageFormat('jpeg');
Config.setConcurrency(6);
