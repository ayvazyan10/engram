CREATE VIRTUAL TABLE memories_fts USING fts5(
  content, concept, tags, content='memories', content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, concept, tags)
  VALUES (new.rowid, new.content, new.concept, new.tags);
END;
--> statement-breakpoint
CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, concept, tags)
  VALUES ('delete', old.rowid, old.content, old.concept, old.tags);
END;
--> statement-breakpoint
CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories
WHEN old.rowid IS NOT new.rowid OR old.content IS NOT new.content
  OR old.concept IS NOT new.concept OR old.tags IS NOT new.tags
BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, concept, tags)
  VALUES ('delete', old.rowid, old.content, old.concept, old.tags);
  INSERT INTO memories_fts(rowid, content, concept, tags)
  VALUES (new.rowid, new.content, new.concept, new.tags);
END;
--> statement-breakpoint
INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');
