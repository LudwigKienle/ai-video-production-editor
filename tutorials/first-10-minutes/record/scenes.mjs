// Directions for the screen scenes. Each one continues from where the previous one
// left the app, so the scenes cut together like one session.
// r.at('word') = when that word is spoken; actions are placed slightly before it.

const side = (page, ws) => page.locator(`[data-studio-action="workspace:${ws}"]`).first();
const phase = (page, id) => page.locator(`[data-studio-action="project-phase:${id}"]`).first();

export const screenScenes = {
  async s03_onboarding(r, { page }) {
    // Step 1: experience
    const card = (text) => page.locator('.app-modal .grid > *').filter({ hasText: text }).first();
    await r.markOf('wizard', page.locator('.app-modal'));
    await r.move(page.getByText('Just getting started'), { at: r.at('Just', 1, -0.4) });
    await r.markOf('simple-card', card('Just getting started'));
    await r.click(page.getByText("I'm a filmmaker / editor"), { at: r.at('filmmaker', 1, 0.2), mark: 'pro-card' });
    await r.click(page.getByRole('button', { name: /^Next/ }), { at: r.at('Next,', 1, -0.1) });
    // Step 2: look
    await r.click(page.getByRole('button', { name: /Dark/ }).first(), { at: r.at('dark', 1, 0.1), mark: 'look-dark' });
    await r.click(page.getByRole('button', { name: /^Next/ }), { at: r.at('Then') });
    // Step 3: connect AI
    await r.markOf('providers', page.locator('.app-modal .onboard-keys'));
    await r.move(page.getByText('Google Gemini'), { at: r.at('Google', 1, -0.3) });
    await r.markOf('gemini', page.locator('.app-modal .settings-provider').filter({ hasText: 'Google Gemini' }).first());
    await r.move(page.getByText(/No key yet/), { at: r.at('stored', 1, -0.2), dx: 0.2 });
    await r.markOf('keys-local', page.getByText(/No key yet/));
    await r.move(page.getByRole('button', { name: 'Skip' }), { at: r.at('skip', 1, -0.3) });
    await r.click(page.getByRole('button', { name: /^Next/ }), { at: r.at('last', 1, -0.2) });
    // Step 4: ready
    await r.markOf('ready', page.getByText("You're all set!"));
    await r.click(page.getByRole('button', { name: /Start Creating/ }), { at: r.at('With', 1, -0.1), settle: 0.8 });
    // Without a key the studio opens Settings → AI providers right after the guide.
    await r.markOf('settings', page.locator('.app-modal, [role="dialog"]').filter({ hasText: 'AI providers' }).first());
    await r.move(page.getByText(/of 13 connected/).first(), { at: r.at('thirteen', 1, -0.3) });
    await r.markOf('providers-count', page.getByText(/of 13 connected/).first());
    await r.click(page.getByRole('button', { name: 'Close', exact: true }).first(), { at: r.at('Close', 1, 0.1) });
  },

  async s04_interface(r, { page }) {
    const nav = page.locator('[aria-label="Workspaces"]').first();
    await r.markOf('sidebar', nav);
    const group = (name) => page.locator(`.app-sidebar__group[aria-label="${name}"] .app-sidebar__label`).first();
    await r.move(group('Project'), { at: r.at('sidebar', 1, 0.2), dx: 0.2 });
    await r.move(group('Create'), { at: r.at('Create,', 1, -0.2), dx: 0.2 });
    await r.move(group('Edit'), { at: r.at('Edit,', 1, -0.2), dx: 0.2 });
    const modes = page.getByRole('radiogroup', { name: 'Interface mode' });
    await r.markOf('modes', modes);
    await r.move(modes, { at: r.at('Simple,', 1, -0.3) });
    await r.click(modes.getByRole('radio', { name: 'Simple' }), { at: r.at('Simple', 2, 0.1) });
    await r.markOf('sidebar-simple', nav);
    await r.click(modes.getByRole('radio', { name: 'Pro' }), { at: r.at('Pro', 2, 0.1) });
    await r.markOf('sidebar-pro', nav);
    await r.move(side(page, 'set_design'), { at: r.at('Set', 1, -0.2) });
    await r.move(side(page, 'scene_map'), { at: r.at('Scene', 1, -0.1) });
    await r.scrollTo(side(page, 'analysis'), { at: r.at('Color', 1, -0.6), dur: 0.6 });
    await r.move(side(page, 'post'), { at: r.at('Color', 1, -0.1) });
    await r.move(side(page, 'analysis'), { at: r.at('Analysis', 1, -0.2) });
    await r.move(page.getByRole('button', { name: /Activity/ }).first(), { at: r.at('Activity', 1, -0.3) });
    await r.markOf('activity', page.getByRole('button', { name: /Activity/ }).first());
    await r.move(page.getByText('AI Tools').first(), { at: r.at('AI', 1, -0.3) });
    await r.markOf('ai-tools', page.getByText('AI Tools').first());
  },

  async s05_folder(r, { page, chooseFolder }) {
    await chooseFolder();
    const menuButton = page.getByRole('button', { name: 'Project menu' });
    await r.markOf('no-folder', menuButton);
    await r.click(menuButton, { at: r.at('Open', 1, 0.2) });
    await r.markOf('project-menu', page.locator('.app-menu--project'));
    await r.click(page.getByText('Choose Project Folder…'), { at: r.at('Choose', 2, 0.3), settle: 1 });
    await r.move(menuButton, { at: r.at('badge', 1, -0.4) });
    await r.markOf('saved', menuButton);
  },

  async s06_script(r, { page, demoScript }) {
    await r.markOf('hub', page.locator('main').first());
    await r.move(page.locator('select').filter({ hasText: 'Feature / Series' }).first(), { at: r.at('format:', 1, -0.3) });
    await r.markOf('format', page.locator('select').filter({ hasText: 'Feature / Series' }).first());
    await r.markOf('steps', phase(page, 'script').locator('xpath=..'));
    await r.move(phase(page, 'script'), { at: r.at('seven', 1, -0.2) });
    await r.move(phase(page, 'marketing'), { at: r.at('production', 1) , dur: 1.2 });
    await r.move(phase(page, 'script'), { at: r.at('script.', 1, -0.6) });
    const editor = page.locator('.script-page__editor textarea').first();
    await r.click(editor, { at: r.at('paste', 1, -0.1), dy: 0.15 });
    await r.paste(editor, demoScript, { at: r.at('Rainline,', 1, 0.1) });
    await r.markOf('script', editor);
    const title = page.getByPlaceholder('Enter project title...');
    await r.click(title, { at: r.at('title', 1, -0.1) });
    await r.type('Rainline', { at: r.at('story', 1, -0.1), cps: 12 });
    await r.markOf('title', title);
    const analyze = page.getByRole('button', { name: /Analyze Script/ });
    await r.move(analyze, { at: r.at('Analyze', 1, -0.4) });
    await r.markOf('analyze', analyze);
  },

  async s07_phases(r, { page }) {
    for (const [id, word] of [['worldbuilding', 'World'], ['concept', 'Concept'], ['storyboard', 'Storyboard'], ['filming', 'Filming'], ['review', 'Review'], ['marketing', 'Marketing']]) {
      await r.click(phase(page, id), { at: r.at(word, 1, -0.05), settle: 0.4 });
      await r.markOf(`phase-${id}`, page.locator('main').first());
    }
  },

  async s08_create(r, { page }) {
    await r.click(side(page, 'image_gen'), { at: r.at('Images', 1, -0.1) });
    await r.click(side(page, 'video_gen'), { at: r.at('Video', 1, -0.1) });
    const readiness = page.getByText(/GENERATION READINESS/i).first();
    await r.scrollTo(readiness, { at: r.at('needs', 1, -0.8) });
    await r.move(readiness, { at: r.at('needs', 1, -0.2) });
    await r.markOf('readiness', readiness.locator('xpath=..'));
    const cost = page.getByText(/ESTIMATED COST/i).first();
    await r.scrollTo(cost, { at: r.at('estimated', 1, -0.7) });
    await r.move(cost, { at: r.at('estimated', 1, -0.1) });
    await r.markOf('cost', cost.locator('xpath=..'));
    await r.click(side(page, 'nodes'), { at: r.at('Node', 1, -0.1), settle: 0.8 });
    await r.markOf('graph', page.locator('main').first());
  },

  async s09_edit_export(r, { page }) {
    await r.scrollTo(side(page, 'edit'), { at: r.at('clips', 1, -0.6) });
    await r.click(side(page, 'edit'), { at: r.at('Timeline', 1, -0.1) });
    const pageTab = (label) => page.locator('.post-pagebar__page').filter({ hasText: label }).first();
    await r.markOf('page-bar', page.locator('.post-pagebar__pages'));
    await r.move(pageTab('Cut'), { at: r.at('cut,', 1, -0.2) });
    await r.move(pageTab('Color'), { at: r.at('color', 1, -0.2) });
    await r.move(pageTab('Fairlight'), { at: r.at('sound.', 1, -0.2) });
    await r.scrollTo(side(page, 'export'), { at: r.at('Export', 1, -0.7) });
    await r.click(side(page, 'export'), { at: r.at('Export', 1, -0.1) });
    for (const name of ['YouTube', 'TikTok', 'Instagram']) {
      const preset = page.getByRole('button', { name: new RegExp(`^${name}`) }).first();
      await r.move(preset, { at: r.at(name, 1, -0.2) });
      await r.markOf(`preset-${name}`, preset);
    }
  },
};
