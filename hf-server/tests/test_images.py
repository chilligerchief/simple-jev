"""Inline-image compilation and independent full-forward scoring tests.

A fake processor exercises data-URL decoding, placeholder expansion, media
tensor capture, and validation errors without downloading a vision model. A
small torch module verifies that HFBackend feeds shared media tensors to one
full forward per branch. These tests check adapter control flow, not real
processor/model compatibility or answer quality.
"""

import base64
import importlib.util
import io
import types

import pytest

from conftest import Tokenizer

pytestmark = pytest.mark.skipif(
    importlib.util.find_spec("torch") is None
    or importlib.util.find_spec("PIL") is None,
    reason="Install torch and pillow",
)

IMAGE_TOKEN = 300
EXPANSION = 4


def data_url(size=(8, 8)):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, (255, 0, 0)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


class Processor:
    """Expand each image into a fixed placeholder run and emit pixel tensors."""

    def apply_chat_template(self, messages, **kwargs):
        assert kwargs == {
            "tokenize": False,
            "add_generation_prompt": True,
            "enable_thinking": False,
        }
        lines = []
        for message in messages:
            # The compiler renders every message with block content.
            assert isinstance(message["content"], list)
            text = "".join(
                block["text"] if block["type"] == "text" else "<image>"
                for block in message["content"]
            )
            lines.append(f"{message['role']}: {text}")
        return "\n".join(lines) + "\nassistant: "

    def __call__(self, text, images=None, **kwargs):
        import torch

        assert kwargs == {"return_tensors": "pt", "add_special_tokens": False}
        ids, rest = [], text[0]
        while rest:
            if rest.startswith("<image>"):
                ids += [IMAGE_TOKEN] * EXPANSION
                rest = rest[len("<image>") :]
            else:
                ids += list(rest[0].encode("utf8"))
                rest = rest[1:]
        out = {
            "input_ids": torch.tensor([ids]),
            "attention_mask": torch.ones(1, len(ids), dtype=torch.long),
        }
        if images:
            for image in images:
                assert image.mode == "RGB"
            out["pixel_values"] = torch.zeros(len(images), 3, 8, 8)
        return out


def image_request(questions=None, url=None):
    return {
        "model": "test",
        "messages": [
            {"role": "system", "content": "Look carefully."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is shown?"},
                    {"type": "image_url", "image_url": {"url": url or data_url()}},
                ],
            },
        ],
        "questions": questions
        or {"red": {"type": "noul", "instructions": "Is the shape red?"}},
    }


def test_compile_expands_images_and_keeps_shared_media():
    from hf_server import PromptCompiler

    compiler = PromptCompiler(Tokenizer(), processor=Processor())
    compiled = compiler.compile(image_request(questions={
        "red": {"type": "noul", "instructions": "Is the shape red?"},
        "kind": {"type": "choice", "instructions": "Shape?",
                 "criteria": {"square": None, "circle": None}},
    }))
    assert compiled.media is not None
    assert tuple(compiled.media["pixel_values"].shape) == (1, 3, 8, 8)
    assert "input_ids" not in compiled.media and "attention_mask" not in compiled.media
    for branch in compiled.branches:
        run = [t for t in branch.token_ids if t == IMAGE_TOKEN]
        assert len(run) == EXPANSION
        assert branch.output_ids and len(set(branch.output_ids)) == len(branch.output_ids)
    # The classifier system merge stays textual on the leading system turn.
    assert compiled.branches[0].messages[0]["role"] == "system"
    assert compiled.branches[0].messages[0]["content"].endswith("Look carefully.")


def test_compile_without_processor_rejects_blocks():
    from hf_server import PromptCompiler

    with pytest.raises(ValueError, match="plain text chat only"):
        PromptCompiler(Tokenizer()).compile(image_request())


@pytest.mark.parametrize(
    "url,match",
    [
        ("https://example.com/a.png", "data URLs"),
        ("data:image/png;base64,", "base64 payload"),
        ("data:image/png;base64,!!!!", "could not be decoded"),
    ],
)
def test_compile_rejects_bad_image_urls(url, match):
    from hf_server import PromptCompiler

    compiler = PromptCompiler(Tokenizer(), processor=Processor())
    with pytest.raises(ValueError, match=match):
        compiler.compile(image_request(url=url))


def test_compile_rejects_unsupported_block_shapes():
    from hf_server import MAX_REQUEST_IMAGES, PromptCompiler

    compiler = PromptCompiler(Tokenizer(), processor=Processor())
    request = image_request()
    request["messages"][0]["content"] = [{"type": "text", "text": "hi"}]
    with pytest.raises(ValueError, match="user/assistant"):
        compiler.compile(request)
    request = image_request()
    request["messages"][1]["content"] = [{"type": "input_audio", "data": "x"}]
    with pytest.raises(ValueError, match="text or image_url"):
        compiler.compile(request)
    request = image_request()
    block = {"type": "image_url", "image_url": {"url": data_url()}}
    request["messages"][1]["content"] = [dict(block) for _ in range(MAX_REQUEST_IMAGES + 1)]
    with pytest.raises(ValueError, match="maximum is"):
        compiler.compile(request)


def test_named_policies_still_reject_image_chat():
    from hf_server import PromptCompiler

    compiler = PromptCompiler(
        Tokenizer(), prompt_policy="repeat_state", processor=Processor()
    )
    with pytest.raises(ValueError, match="baseline for chat"):
        compiler.compile(image_request())


class VisionModel:
    """Minimal multimodal double: records forwards and returns seeded logits."""

    def __init__(self, vocab=512):
        import torch

        self.emb = torch.nn.Embedding(vocab, 8)
        self.calls = []

    def eval(self):
        return self

    def get_input_embeddings(self):
        return self.emb

    def forward(
        self,
        input_ids,
        attention_mask=None,
        pixel_values=None,
        use_cache=None,
        logits_to_keep=None,
        **kwargs,
    ):
        import torch

        self.calls.append(
            (
                tuple(input_ids.shape),
                None if pixel_values is None else tuple(pixel_values.shape),
            )
        )
        generator = torch.Generator().manual_seed(int(input_ids.sum()))
        width = 1 if logits_to_keep == 1 else input_ids.shape[1]
        logits = torch.randn(
            input_ids.shape[0], width, self.emb.num_embeddings, generator=generator
        )
        return types.SimpleNamespace(logits=logits, past_key_values=None)

    __call__ = forward


async def test_backend_runs_one_full_forward_per_image_branch():
    from hf_server import Branch, CompiledRequest, HFBackend
    import torch

    model = VisionModel()
    backend = HFBackend(model)
    media = {"pixel_values": torch.zeros(1, 3, 8, 8), "image_grid": [[1, 2, 2]]}
    branches = [
        Branch("a", [5, IMAGE_TOKEN, IMAGE_TOKEN, 9, 10], [30, 31], [], ""),
        Branch("b", [5, IMAGE_TOKEN, IMAGE_TOKEN, 9, 11, 12], [30, 31], [], ""),
    ]
    result = await backend.score(CompiledRequest(None, branches, (), media))
    assert result.metrics["prefill_strategy"] == "independent_full_prompts"
    assert result.metrics["engine_forwards"] == 2
    assert result.metrics["logical_prefill_tokens"] == 11
    # Every branch is one unpadded row carrying the shared pixel tensors.
    assert model.calls == [((1, 5), (1, 3, 8, 8)), ((1, 6), (1, 3, 8, 8))]
    for row in result.logits.values():
        assert tuple(row.shape) == (2,)


async def test_http_image_request_end_to_end():
    import httpx
    from hf_server import DecisionService, HFBackend, PromptCompiler, create_app

    model = VisionModel()
    compiler = PromptCompiler(Tokenizer(), processor=Processor())
    service = DecisionService(
        "test", compiler, HFBackend(model), advanced_metrics=True
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app(service)), base_url="http://test"
    ) as client:
        response = await client.post("/v1/classifier", json=image_request())
        assert response.status_code == 200, response.text
        body = response.json()
        assert 0.01 <= body["answers"]["red"]["noul"] <= 0.99
        assert body["metrics"]["prefill_strategy"] == "independent_full_prompts"
        assert body["usage"]["input_tokens"] > 0
        assert all(shape is not None for _, shape in model.calls)
        # Remote URLs stay rejected at the HTTP boundary.
        bad = await client.post(
            "/v1/classifier", json=image_request(url="https://example.com/a.png")
        )
        assert bad.status_code == 422
