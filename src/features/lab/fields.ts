import {contactFields} from "../people/model"
// Detail fields Command still validates: a person's contact details, and the program fields a
// project may carry after an AI Program was folded into it (plus its migration markers).
export type Field = {key:string;label:string;type:string;options?:string[]}
export const fields:Record<string,Field[]> = {
  person: [...contactFields],
  "project": [
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
  ,
    {
      "key": "migrated_from",
      "label": "Migrated from",
      "type": "text"
    },
    {
      "key": "migrated_to",
      "label": "Migrated to",
      "type": "text"
    }
  ]
}
