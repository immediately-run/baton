-- S-BTN-48: the offered snapshot's contract, independent of later registry posts.
ALTER TABLE claims ADD COLUMN contract_course_json TEXT;
ALTER TABLE claims ADD COLUMN contract_course_version INTEGER;
