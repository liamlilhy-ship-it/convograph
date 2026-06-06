import { selectPlatform } from '../platforms/registry';
import { mount } from './mount';

// Resolve the platform for this host (dynamic import — only the active platform's
// code loads) and mount the panel. The manifest restricts us to known hosts, so
// selectPlatform only returns null defensively.
void selectPlatform(location.hostname).then((platform) => {
  if (platform) mount(platform);
});
