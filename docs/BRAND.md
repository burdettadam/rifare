# Rifare brand assets

Rifare's presentation starts with a clear promise: **Own what happens after
checkout.** The supporting description is **Merchant-owned commerce operations.**
The artwork connects that idea to a parcel continuing through a folded path.

## Identity

The geometric folded **r** combines a continuous route with a forward turn.
Evergreen carries the wordmark; the bright leaf fold makes the symbol recognizable
at a glance. The large hero translates the mark into a sculptural parcel route.
The social card uses a dark field and a simpler treatment of the same form.

| Design color | Reference | Use |
| --- | --- | --- |
| Evergreen | `#163C32` | Identity, text, and dark backgrounds |
| Leaf | `#C0EC88` | Return fold and selective accents |
| Porcelain | `#F7F6EF` | Light backgrounds and generous space |
| Apricot | `#F0A982` | Small supporting accents |

These are art-direction references; the generated raster artwork contains
additional antialiasing and illustration tones. Its wordmark is embedded artwork,
not a bundled or identified commercial font. Use a system sans-serif family for
surrounding documentation and interfaces.

## Asset set

| File | Dimensions | Intended use |
| --- | --- | --- |
| [rifare-logo.png](assets/rifare-logo.png) | 2172 × 724, transparent | Horizontal logo on a light surface |
| [rifare-mark.png](assets/rifare-mark.png) | 1254 × 1254, transparent | Standalone identity mark on a light surface |
| [rifare-hero.png](assets/rifare-hero.png) | 1774 × 887 | README and portfolio hero |
| [rifare-social.png](assets/rifare-social.png) | 1774 × 887 | Social artwork master |
| [rifare-social.jpg](assets/rifare-social.jpg) | 1774 × 887; under 1 MB | GitHub social preview upload |

The [asset manifest](assets/manifest.json) records exact file sizes and SHA-256
digests. [Generation prompts](assets/PROMPTS.md) preserve the visual brief and
reference order. All artwork was created with the built-in image-generation tool;
the social JPEG is a format export of the PNG master.

## Usage

- Keep the logo's proportions and clear space. Do not stretch or rotate it.
- Use the transparent evergreen logo and mark on light surfaces. For a dark cover,
  use the supplied social artwork, whose lettering is light.
- Keep the hero's important text and mark inside the visible frame. For another
  aspect ratio, create a deliberate new composition instead of clipping the copy.
- Use live text next to artwork for the project name, positioning, and important
  links. The README's heading and summary remain accessible without its image.
- Treat the parcel illustration as conceptual brand art. It is not a screenshot,
  workflow specification, proof of an integration, or evidence of production use.

The README uses repository-relative image paths, so its artwork remains available
in clones and follows the viewed Git branch. No remote image host is required.

## Public positioning

Lead with the merchant's workflow and control: returns, exchanges, support,
order changes, and reverse logistics. Explain optional agents through concrete
design choices: shared approvals, current-state checks, durable operation identity,
and replaceable providers. Use the [current status](PROJECT-STATUS.md) to qualify
availability. Avoid production, deployment, live-provider, performance, or licensed
open-source claims that the current source and project terms do not establish.

Original brand files and recorded demonstration media use Apache-2.0 to the extent
copyright or other licensable rights exist, as described in the
[component license map](../LICENSES/README.md). This does not assert trademark
clearance or grant rights in third-party material. No third-party font files,
logos, or reference images were bundled.
