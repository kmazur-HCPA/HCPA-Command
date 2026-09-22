import {contactFields} from "../people/model"
export type Field = {key:string;label:string;type:string;options?:string[]}
export const fields:Record<string,Field[]> = {
  person: [...contactFields],
  "learning": [
    {
      "key": "provider",
      "label": "Provider / author",
      "type": "text"
    },
    {
      "key": "type",
      "label": "Learning type",
      "type": "select",
      "options": [
        "Course",
        "Article",
        "Paper",
        "Video",
        "Webinar",
        "Conference",
        "Podcast",
        "Book",
        "Documentation",
        "Tutorial",
        "Other"
      ]
    },
    {
      "key": "url",
      "label": "Source URL",
      "type": "url"
    },
    {
      "key": "start_date",
      "label": "Start date",
      "type": "date"
    },
    {
      "key": "completion_date",
      "label": "Completion date",
      "type": "date"
    },
    {
      "key": "progress",
      "label": "Progress (%)",
      "type": "number"
    },
    {
      "key": "topic",
      "label": "Topic",
      "type": "text"
    },
    {
      "key": "takeaways",
      "label": "Key takeaways",
      "type": "textarea"
    },
    {
      "key": "usefulness",
      "label": "Usefulness",
      "type": "select",
      "options": [
        "Not assessed",
        "Low",
        "Moderate",
        "High"
      ]
    },
    {
      "key": "applicability",
      "label": "HCPA applicability",
      "type": "textarea"
    }
  ],
  "program": [
    {
      "key": "definition",
      "label": "Program definition",
      "type": "textarea"
    },
    {
      "key": "objectives",
      "label": "Objectives",
      "type": "textarea"
    },
    {
      "key": "milestones",
      "label": "Milestones",
      "type": "textarea"
    },
    {
      "key": "roadmap",
      "label": "Roadmap",
      "type": "textarea"
    },
    {
      "key": "current_state",
      "label": "Current state",
      "type": "textarea"
    },
    {
      "key": "accomplishments",
      "label": "Accomplishments",
      "type": "textarea"
    },
    {
      "key": "risks",
      "label": "Risks",
      "type": "textarea"
    },
    {
      "key": "next_work",
      "label": "Upcoming work",
      "type": "textarea"
    },
    {
      "key": "governance",
      "label": "Governance references and decisions",
      "type": "textarea"
    },
    {
      "key": "platforms",
      "label": "Approved platforms and conditions",
      "type": "textarea"
    },
    {
      "key": "data_handling",
      "label": "Data handling, privacy and records",
      "type": "textarea"
    },
    {
      "key": "human_review",
      "label": "Human review requirements",
      "type": "textarea"
    }
  ],
  "use_case": [
    {
      "key": "problem",
      "label": "Problem",
      "type": "textarea"
    },
    {
      "key": "proposed_use",
      "label": "Proposed AI use",
      "type": "textarea"
    },
    {
      "key": "department",
      "label": "Department / function",
      "type": "text"
    },
    {
      "key": "owner",
      "label": "Accountable owner",
      "type": "text"
    },
    {
      "key": "data_involved",
      "label": "Data involved",
      "type": "textarea"
    },
    {
      "key": "risk",
      "label": "Risk level",
      "type": "select",
      "options": [
        "Not assessed",
        "Low",
        "Moderate",
        "High"
      ]
    },
    {
      "key": "expected_benefit",
      "label": "Expected benefit",
      "type": "textarea"
    },
    {
      "key": "actual_benefit",
      "label": "Actual benefit",
      "type": "textarea"
    },
    {
      "key": "requirements",
      "label": "Technical requirements",
      "type": "textarea"
    },
    {
      "key": "decision",
      "label": "Decision and rationale",
      "type": "textarea"
    }
  ],
  "experiment": [
    {
      "key": "question",
      "label": "Question",
      "type": "textarea"
    },
    {
      "key": "hypothesis",
      "label": "Hypothesis",
      "type": "textarea"
    },
    {
      "key": "tool",
      "label": "Tool / provider",
      "type": "text"
    },
    {
      "key": "model",
      "label": "Model and version",
      "type": "text"
    },
    {
      "key": "setup",
      "label": "Setup",
      "type": "textarea"
    },
    {
      "key": "inputs",
      "label": "Inputs / data used",
      "type": "textarea"
    },
    {
      "key": "results",
      "label": "Results",
      "type": "textarea"
    },
    {
      "key": "problems",
      "label": "Problems",
      "type": "textarea"
    },
    {
      "key": "conclusion",
      "label": "Conclusion",
      "type": "textarea"
    },
    {
      "key": "next_action",
      "label": "Next action",
      "type": "textarea"
    }
  ],
  "library": [
    {
      "key": "category",
      "label": "Category",
      "type": "select",
      "options": [
        "HCPA",
        "AI Governance",
        "Research",
        "Learning",
        "Command"
      ]
    },
    {
      "key": "classification",
      "label": "Classification",
      "type": "select",
      "options": [
        "Public",
        "Internal"
      ]
    },
    {
      "key": "source",
      "label": "Source",
      "type": "text"
    },
    {
      "key": "author",
      "label": "Author",
      "type": "text"
    },
    {
      "key": "url",
      "label": "Source URL",
      "type": "url"
    },
    {
      "key": "document_date",
      "label": "Document date",
      "type": "date"
    }
  ]
}
