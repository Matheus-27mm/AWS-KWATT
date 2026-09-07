from energia.lambdas import outbox


class FakeSink:
    def __init__(self):
        self.events = []

    def emit(self, detail_type, detail):
        self.events.append((detail_type, detail))


class FakeDynamo:
    def __init__(self):
        self.deletes = []

    def delete_item(self, **kwargs):
        self.deletes.append(kwargs)


def test_outbox_publica_e_remove(monkeypatch):
    sink, dynamo = FakeSink(), FakeDynamo()
    monkeypatch.setattr(outbox, "_deps", lambda: (sink, dynamo))
    monkeypatch.setenv("ENERGIA_TABLE_NAME", "energia-test")
    event = {
        "Records": [
            {
                "eventID": "stream-1",
                "eventName": "INSERT",
                "dynamodb": {
                    "NewImage": {
                        "PK": {"S": "OUTBOX#alert|abc"},
                        "SK": {"S": "EVENT"},
                        "type": {"S": "OutboxEvent"},
                        "event_id": {"S": "alert|abc"},
                        "detail_type": {"S": "Alerta"},
                        "detail": {"M": {"id": {"S": "abc"}}},
                    }
                },
            }
        ]
    }
    assert outbox.handler(event, None) == {"batchItemFailures": [], "published": 1}
    assert sink.events == [("Alerta", {"id": "abc"})]
    assert dynamo.deletes[0]["Key"] == {"PK": {"S": "OUTBOX#alert|abc"}, "SK": {"S": "EVENT"}}
