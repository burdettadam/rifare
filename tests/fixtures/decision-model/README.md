# Independent M13 decision wire fixtures

These handwritten inputs and expected answers are synthetic transport fixtures,
committed before implementation. No model, account, request latency or measured
classification quality produced them. The normalized and Workers AI envelopes
represent the same finite answers; the malformed envelope changes only the chosen
option to the unpublished `unpublished` identifier.

`request.json` keeps a customer claim, a verified fact and an unavailable source
explicitly distinct. Its repeated-letter question digest is a synthetic identifier,
not evidence that the fixture's question resource was published or approved.
The score's independent expected value is `0*0.1 + 1*0.3 + 2*0.6 = 1.5`.

Wire sources inspected on 2026-10-19:

- [Current hosted schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/clef-flash.json), blob `196002072fc4ece5d7dbf94d66c0d2b788e90cf0`.
- [Official REST adapter](https://github.com/cloudflare/langchain-cloudflare/blob/main/libs/langchain-cloudflare/langchain_cloudflare/decision_models.py), blob `2be2ba8334e55d8a31c44744b964b335a747cd74`.
- [Released response implementation](https://huggingface.co/Cloudflare/clef-flash/blob/main/joint_schema_model.py), displayed source revision `41318bf`.
- [Hosted model documentation](https://developers.cloudflare.com/workers-ai/models/clef-flash/).

The endpoint uses `@cf/cloudflare/clef-flash`; its body selector is `clef-flash`.
The current hosted context is 24,576 tokens and long text can be truncated by the
provider. Rifare must reject oversized required input before dispatch. Fixture
compatibility does not qualify the hosted tokenizer, deployment revision, price,
quality or actual API behavior.
