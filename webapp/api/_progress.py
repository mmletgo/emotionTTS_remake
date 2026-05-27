"""
后台任务进度的进程内状态。

设计取舍：进度查询是 API 层关心的事（"前端轮询"），不属于 domain；但需要在
多个 router 之间共享同一个字典，所以单独抽出来放在 api 包内部。

跨进程不可用；进程重启后所有 task_progress 丢失（已在 PRD 已知缺口章节说明）。

stage 字段（可选）：标记当前所处阶段，供前端分阶段渲染。
取值约定：'slicing'（切片中）| 'asr'（转写中）| 'tagging'（LLM 打标中）| 'writing'（写入中）| None（不区分阶段）
"""
from typing import Any

task_progress: dict[str, dict[str, Any]] = {}


def make_updater(task_id: str):
    """
    Business Logic（为什么需要这个函数）:
        domain 层的 library_builder.build_character_dataset 在后台跑时需要往进度
        字典里写状态；但 domain 不应直接 import api 层的字典。通过工厂返回一个闭包，
        让 api 层注入"如何写进度"。

    Code Logic（这个函数做什么）:
        返回一个 (progress, msg, status="running", stage=None) → None 的闭包，
        闭包内向 task_progress[task_id] 写状态。stage 为可选参数，向后兼容——
        旧调用方不传 stage 时，进度字典的 stage 字段为 None。
    """

    def update(progress: int, msg: str, status: str = "running", stage: str | None = None) -> None:
        task_progress[task_id] = {"progress": progress, "msg": msg, "status": status, "stage": stage}

    return update


def get(task_id: str) -> dict[str, Any]:
    """读取指定 task_id 的进度；不存在时返回"等待中"占位。"""
    return task_progress.get(task_id, {"progress": 0, "msg": "等待中...", "status": "running", "stage": None})
