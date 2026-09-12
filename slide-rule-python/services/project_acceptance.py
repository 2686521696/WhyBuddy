"""The first managed business acceptance profile; not arbitrary goal completion.

This scope is explicit and versioned. Selecting a template alone does not certify
unlisted requirements (for example billing or integrations). A release must name
this profile and carry its independent runtime evidence for the same source.
"""

TASK_ACCEPTANCE_PROFILE = "whybuddy-tasks-acceptance@1"
TASK_TEMPLATE_VERSION = "whybuddy-react-vite-tasks-1"


def template_verification_capabilities(template_version):
    suite = {TASK_TEMPLATE_VERSION: "react-vite-tasks@1",
        "whybuddy-react-vite-1": "react-vite-counter@1"}.get(template_version)
    return ["verification:" + suite] if suite else []


TASK_REQUIREMENTS = (
    "Independent application administrator and reader login",
    "Create, edit and filter tasks through a real API",
    "Persist application data across page refresh",
    "Reject writes by readers and unauthenticated users",
    "Build locked source and render without resource or page errors",
)


def acceptance_profile():
    return {"profileId": TASK_ACCEPTANCE_PROFILE, "suiteVersion": "react-vite-tasks@1",
        "requirements": list(TASK_REQUIREMENTS),
        "outsideScope": ["Additional user requirements", "Production deployment", "Production account operations"],
        "dataRecovery": "Last durable checkpoint; normal stop checkpoints after stopping the application"}
