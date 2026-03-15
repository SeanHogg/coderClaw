# Cloudflare Pages Setup

This document describes how to deploy the CoderClaw website to Cloudflare Pages.

## Prerequisites

1. A Cloudflare account
2. GitHub repository access to SeanHogg/coderclaw.ai

## Setup Instructions

### Option 1: Automatic Deployment via GitHub Actions (Recommended)

The repository includes a GitHub Actions workflow (`.github/workflows/cloudflare-pages.yml`) that automatically deploys to Cloudflare Pages on every push to the `main` branch.

#### Required GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

1. **CLOUDFLARE_API_TOKEN**
   - Go to Cloudflare Dashboard → My Profile → API Tokens
   - Click "Create Token"
   - Use the "Edit Cloudflare Workers" template or create a custom token with:
     - Permissions: `Account.Cloudflare Pages — Edit`
   - Copy the token and add it as a GitHub secret

2. **CLOUDFLARE_ACCOUNT_ID**
   - Go to Cloudflare Dashboard
   - Select any domain
   - Copy the Account ID from the right sidebar
   - Add it as a GitHub secret

### Option 2: Manual Deployment via Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to "Workers & Pages" → "Create application" → "Pages" → "Connect to Git"
3. Select your GitHub repository: `SeanHogg/coderclaw.ai`
4. Configure build settings:
   - **Project name**: `coderclaw-ai`
   - **Production branch**: `main`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (leave empty)
5. Click "Save and Deploy"

### Build Configuration

The website uses Astro as its static site generator:

- **Framework**: Astro
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Node version**: 20.x (automatically detected)

### Environment Variables

No environment variables are required for the basic deployment.

### Custom Domain Setup

1. In Cloudflare Pages project settings, go to "Custom domains"
2. Click "Set up a custom domain"
3. Enter your domain: `coderclaw.ai`
4. Follow the DNS configuration instructions
5. Wait for DNS propagation (usually a few minutes)

## Deployment

### Automatic (via GitHub Actions)

Simply push to the `main` branch:

```bash
git push origin main
```

The GitHub Action will automatically build and deploy your site.

### Manual (via Cloudflare Dashboard)

Cloudflare Pages will automatically deploy when you push to the configured production branch. You can also trigger manual deployments from the Cloudflare Dashboard.

## Troubleshooting

### Build Failures

If the build fails, check:
1. The build logs in Cloudflare Pages or GitHub Actions
2. Run `npm run build` locally to reproduce the error
3. Ensure all dependencies are correctly specified in `package.json`

### DNS Issues

If your custom domain isn't working:
1. Verify DNS records are correctly configured in Cloudflare
2. Wait for DNS propagation (can take up to 24 hours)
3. Check SSL/TLS settings (should be set to "Full" or "Full (strict)")

## Additional Resources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Astro Documentation](https://docs.astro.build/)
- [GitHub Actions with Cloudflare Pages](https://github.com/marketplace/actions/cloudflare-pages-github-action)
