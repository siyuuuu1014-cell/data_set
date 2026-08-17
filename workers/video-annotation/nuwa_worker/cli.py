"""Environment diagnostics and model lifecycle commands."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import shutil
import sys
from pathlib import Path
from typing import Any

from config import (
    DATA_ROOT,
    DEVICE,
    FFMPEG_PATH,
    FFPROBE_PATH,
    GPU_CONCURRENCY,
    MODEL_MANIFEST_FILE,
    WORKER_HOST,
    WORKER_PORT,
)
from providers.registry import (
    PROFILE_PROVIDERS,
    PROVIDER_SPECS,
    download_provider,
    has_hf_token,
    provider_status,
    provider_statuses,
    providers_for_profile,
)


def _tool_path(command: str) -> str | None:
    path = Path(command).expanduser()
    if path.exists():
        return str(path.resolve())
    return shutil.which(command)


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def doctor_report() -> dict[str, Any]:
    disk = shutil.disk_usage(DATA_ROOT)
    providers = provider_statuses(check_models=True)
    report: dict[str, Any] = {
        "status": "ok",
        "python": {
            "version": platform.python_version(),
            "executable": sys.executable,
            "platform": platform.platform(),
        },
        "worker": {
            "host": WORKER_HOST,
            "port": WORKER_PORT,
            "device": DEVICE,
            "gpuConcurrencyConfigured": GPU_CONCURRENCY,
            "gpuConcurrencyApplied": 1,
            "dataRoot": str(DATA_ROOT),
            "modelManifest": str(MODEL_MANIFEST_FILE),
        },
        "tools": {
            "ffmpeg": _tool_path(FFMPEG_PATH),
            "ffprobe": _tool_path(FFPROBE_PATH),
        },
        "disk": {
            "freeGb": round(disk.free / (1024 ** 3), 1),
            "totalGb": round(disk.total / (1024 ** 3), 1),
        },
        "packages": {
            name: _package_version(name)
            for name in [
                "torch", "torchvision", "transformers", "accelerate",
                "ultralytics", "huggingface-hub", "scenedetect",
            ]
        },
        "providers": providers,
        "warnings": [],
    }
    if not report["tools"]["ffmpeg"] or not report["tools"]["ffprobe"]:
        report["status"] = "needs_attention"
        report["warnings"].append("FFmpeg and FFprobe are required for video processing")
    unavailable = [
        provider["id"]
        for provider in providers
        if provider["enabled"] and provider["status"] not in {"ready", "loaded"}
    ]
    if unavailable:
        report["status"] = "needs_attention"
        report["warnings"].append(
            f"Enabled providers needing setup: {', '.join(unavailable)}"
        )
    if disk.free < 10 * 1024 ** 3:
        report["status"] = "needs_attention"
        report["warnings"].append("Less than 10 GB is free in the worker data volume")
    if GPU_CONCURRENCY != 1:
        report["warnings"].append(
            "GPU_CONCURRENCY is configured but the current queue intentionally remains sequential"
        )
    if not has_hf_token():
        report["warnings"].append(
            "HF_TOKEN is not set; cached public models can still be used, but gated downloads may fail"
        )
    return report


def _print_doctor(report: dict[str, Any]) -> None:
    print(f"Nuwa video worker doctor: {report['status']}")
    print(f"Python: {report['python']['version']} ({report['python']['executable']})")
    print(f"Device: {report['worker']['device']}")
    print(f"FFmpeg: {report['tools']['ffmpeg'] or 'MISSING'}")
    print(f"FFprobe: {report['tools']['ffprobe'] or 'MISSING'}")
    print(f"Disk free: {report['disk']['freeGb']} GB")
    print("Providers:")
    for provider in report["providers"]:
        reason = f" - {provider['reason']}" if provider.get("reason") else ""
        print(f"  {provider['id']}: {provider['status']}{reason}")
    for warning in report["warnings"]:
        print(f"WARNING: {warning}")


def _models_command(args: argparse.Namespace) -> int:
    if args.models_action in {"list", "verify"}:
        if args.provider:
            provider_ids = args.provider
        elif args.profile:
            provider_ids = list(providers_for_profile(args.profile))
        else:
            provider_ids = list(PROVIDER_SPECS)
        statuses = [
            vars(provider_status(provider_id, check_model=True))
            for provider_id in provider_ids
        ]
        if args.json:
            print(json.dumps({"providers": statuses}, indent=2))
        else:
            for status in statuses:
                reason = f" - {status['reason']}" if status.get("reason") else ""
                print(f"{status['id']}: {status['status']}{reason}")
        if args.models_action == "verify":
            failed = [s for s in statuses if s["enabled"] and s["status"] not in {"ready", "loaded"}]
            return 1 if failed else 0
        return 0

    provider_ids = list(args.provider or providers_for_profile(args.profile))
    results: list[dict[str, Any]] = []
    failed = False
    for provider_id in provider_ids:
        if provider_id not in PROVIDER_SPECS:
            results.append({"provider": provider_id, "status": "error", "error": "Unknown provider"})
            failed = True
            continue
        try:
            result = download_provider(provider_id)
            results.append(result)
            if not args.json:
                print(f"{provider_id}: {result['status']} ({result.get('path') or 'no model required'})")
        except Exception as error:
            failed = True
            results.append({"provider": provider_id, "status": "error", "error": str(error)})
            if not args.json:
                print(f"{provider_id}: ERROR - {error}", file=sys.stderr)
    if args.json:
        print(json.dumps({"results": results}, indent=2))
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m nuwa_worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="Inspect worker dependencies and provider readiness")
    doctor.add_argument("--json", action="store_true")

    models = subparsers.add_parser("models", help="Inspect or provision model files")
    model_subparsers = models.add_subparsers(dest="models_action", required=True)
    for action in ["list", "verify"]:
        action_parser = model_subparsers.add_parser(action)
        action_parser.add_argument("--profile", choices=sorted(PROFILE_PROVIDERS))
        action_parser.add_argument("--provider", action="append", choices=sorted(PROVIDER_SPECS))
        action_parser.add_argument("--json", action="store_true")
    download = model_subparsers.add_parser("download")
    download.add_argument("--profile", choices=sorted(PROFILE_PROVIDERS), default="full")
    download.add_argument("--provider", action="append", choices=sorted(PROVIDER_SPECS))
    download.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "doctor":
        report = doctor_report()
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            _print_doctor(report)
        return 0
    if args.command == "models":
        return _models_command(args)
    return 2
