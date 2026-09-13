import { defineConfig, type DefaultTheme } from 'vitepress';

const repository = 'https://github.com/tobiaswaelde/ezrepo';
const site = 'https://tobiaswaelde.github.io/ezrepo/';

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'Overview', link: '/getting-started/' },
      { text: 'Sign in and navigation', link: '/guide/sign-in-navigation' },
    ],
  },
  {
    text: 'User guide',
    items: [
      { text: 'Workflow dashboard', link: '/guide/dashboard' },
      { text: 'Workflow queues', link: '/guide/workflow-queues' },
      { text: 'Repository synchronization jobs', link: '/guide/jobs' },
      { text: 'Issues and pull requests', link: '/guide/issues-pull-requests' },
      { text: 'Repositories and notifications', link: '/guide/repositories-notifications' },
      { text: 'Administration and settings', link: '/guide/administration' },
    ],
  },
  {
    text: 'Operations',
    items: [
      { text: 'Deployment', link: '/deployment' },
      { text: 'Authentication', link: '/authentication' },
      { text: 'MCP access', link: '/mcp' },
      { text: 'Notifications', link: '/notifications' },
    ],
  },
  {
    text: 'Providers',
    items: [
      { text: 'OAuth setup', link: '/provider-oauth' },
      { text: 'Manual webhooks', link: '/provider-webhooks' },
    ],
  },
  {
    text: 'Reference',
    items: [
      { text: 'Tracked repositories', link: '/repositories' },
      { text: 'Interface localization', link: '/localization' },
    ],
  },
];

export default defineConfig({
  title: 'ezRepo',
  description: 'Documentation for the read-only workflow status dashboard for GitHub, GitLab, Forgejo, and Gitea.',
  lang: 'en-US',
  base: '/ezrepo/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: site },
  head: [
    ['meta', { name: 'theme-color', content: '#3451b2' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ezRepo' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Documentation for the read-only workflow status dashboard for GitHub, GitLab, Forgejo, and Gitea.',
      },
    ],
  ],
  transformHead({ pageData }) {
    const relative = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    return [['link', { rel: 'canonical', href: new URL(relative, site).href }]];
  },
  themeConfig: {
    siteTitle: 'ezRepo',
    nav: [
      { text: 'User guide', link: '/getting-started/' },
      { text: 'Operations', link: '/deployment' },
      { text: 'Providers', link: '/provider-oauth' },
      { text: 'Reference', link: '/repositories' },
      { text: 'GitHub', link: repository },
    ],
    sidebar,
    outline: { label: 'On this page', level: [2, 3] },
    notFound: {
      title: 'Page not found',
      quote: 'The requested documentation page does not exist or has moved.',
      linkLabel: 'Go to the documentation home page',
      linkText: 'Home',
    },
    docFooter: { prev: 'Previous', next: 'Next' },
    lastUpdated: { text: 'Last updated' },
    editLink: { pattern: `${repository}/edit/main/docs/:path`, text: 'Edit this page' },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: repository }],
  },
});
