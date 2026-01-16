/* BioQuest MVP - game.js (FULL FILE, POLISHED VISUALS - FIXED HITBOXES + ENEMIES)
   Works on GitHub Pages.

   Visual upgrades:
   - Procedurally generated textures (no external assets)
   - Player looks like a cell (membrane + nucleus)
   - Platforms are rounded tiles (less blocky)
   - Coins and Q-blocks use textures

   Gameplay fixes:
   - Enemies reliably move/patrol and recover if they stall
   - Q-blocks have solid collision on top/sides (stand on them)
   - Questions trigger ONLY when hit from below (Mario-style)

   Files expected:
   - /shared/storage.js  (provides window.BQ)
   - /data/questions_world1-1.json
*/

(() => {
  const UI = document.getElementById("ui");

  function uiTemplate() {
    UI.innerHTML = `
      <div class="panel">
        <div class="row">
          <div>
            <label>Class Code</label>
            <input id="classCode" placeholder="e.g., AB3K9Q" maxlength="12" />
            <div class="small">Teacher creates this code in the dashboard.</div>
          </div>
          <div>
            <label>Student ID (nickname or last-4)</label>
            <input id="studentId" placeholder="e.g., MARLIN123 or 4821" maxlength="24" />
            <div class="small">Use a non-identifying nickname if desired.</div>
          </div>
          <div>
            <label>Mode</label>
            <select id="mode">
              <option value="assessment">Assessment</option>
              <option value="practice">Practice</option>
            </select>
            <div class="small">Assessment uses attempts/lives; Practice can be infinite.</div>
          </div>
        </div>
        <div class="row">
          <button id="startBtn">Start World 1-1</button>
        </div>
        <div class="small">
          Controls: A/D or ◀▶ to move. ▲ to jump. Stomp enemies from above.
        </div>
      </div>
    `;
  }

  uiTemplate();

  const startBtn = document.getElementById("startBtn");
  startBtn.addEventListener("click", onStart);

  async function onStart() {
    const classCode = (document.getElementById("classCode").value || "").trim().toUpperCase();
    const studentId = (document.getElementById("studentId").value || "").trim();
    const mode = document.getElementById("mode").value;

    if (!classCode || !studentId) {
      alert("Enter Class Code and Student ID.");
      return;
    }
    if (!window.BQ) {
      alert("Storage library not loaded. Ensure shared/storage.js is included before game.js.");
      return;
    }

    const settings = BQ.getClassSettings(classCode);

    let questionBank;
    try {
      const res = await fetch("./data/questions_world1-1.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`questions_world1-1.json HTTP ${res.status}`);
      questionBank = await res.json();
      if (!questionBank?.questions?.length) throw new Error("Question bank is empty or malformed.");
    } catch (e) {
      console.error(e);
      alert("Game failed to load question data.\n\n" + e.message);
      return;
    }

    const session = {
      classCode,
      studentId,
      mode,
      settings,
      startedAtISO: new Date().toISOString()
    };

    UI.innerHTML = `
      <div class="panel">
        <span class="badge">Class ${escapeHtml(classCode)}</span>
        <span class="badge">Student ${escapeHtml(studentId)}</span>
        <span class="badge">${escapeHtml(mode)}</span>
      </div>
    `;

    startGame(session, questionBank);
  }

  function startGame(session, questionBank) {
    const config = {
      type: Phaser.AUTO,
      parent: "game",
      width: 960,
      height: 540,
      physics: {
        default: "arcade",
        arcade: { debug: false, gravity: { y: 0 } }
      },
      scene: [makeScene(session, questionBank)]
    };

    if (window.__bioquestGame) window.__bioquestGame.destroy(true);
    window.__bioquestGame = new Phaser.Game(config);
  }

  function makeScene(session, questionBank) {
    return class BioQuestScene extends Phaser.Scene {
      constructor() {
        super("BioQuestScene");
        this.score = 0;
        this.correct = 0;
        this.answered = 0;
        this.lives = 3;
        this.attempt = 1;
        this.levelStartMs = 0;
        this.qIndex = 0;
      }

      // ----- Texture generation (no external assets) -----
      createProceduralTextures() {
        if (this.textures.exists("cellPlayer")) return;

        // Player cell texture (48x48)
        {
          const g = this.make.graphics({ x: 0, y: 0, add: false });
          const size = 48;
          const cx = size / 2;
          const cy = size / 2;

          g.fillStyle(0x5fd3ff, 1);
          g.fillCircle(cx, cy, 20);

          g.fillStyle(0xb8f0ff, 0.45);
          g.fillCircle(cx - 6, cy - 8, 10);

          g.fillStyle(0x3a4cff, 0.9);
          g.fillCircle(cx + 6, cy + 6, 8);

          g.fillStyle(0xffffff, 0.5);
          g.fillCircle(cx + 3, cy + 3, 3);

          g.lineStyle(3, 0x0b2a33, 0.9);
          g.strokeCircle(cx, cy, 20);

          g.generateTexture("cellPlayer", size, size);
          g.destroy();
        }

        // Platform tile (64x24)
        {
          const p = this.make.graphics({ x: 0, y: 0, add: false });
          p.fillStyle(0x2f2f2f, 1);
          p.fillRoundedRect(0, 0, 64, 24, 10);
          p.lineStyle(2, 0x4a4a4a, 1);
          p.strokeRoundedRect(0, 0, 64, 24, 10);
          p.generateTexture("platform64", 64, 24);
          p.destroy();
        }

        // Coin (20x20)
        {
          const c = this.make.graphics({ x: 0, y: 0, add: false });
          c.fillStyle(0xffd34d, 1);
          c.fillCircle(10, 10, 9);
          c.fillStyle(0xffffff, 0.45);
          c.fillCircle(7, 7, 4);
          c.generateTexture("coin20", 20, 20);
          c.destroy();
        }

        // Q-block (28x28) - line-based "?" for compatibility
        {
          const q = this.make.graphics({ x: 0, y: 0, add: false });
          q.fillStyle(0xdedcff, 1);
          q.fillRoundedRect(0, 0, 28, 28, 6);
          q.lineStyle(2, 0xffffff, 1);
          q.strokeRoundedRect(0, 0, 28, 28, 6);

          q.lineStyle(3, 0x333366, 1);
          q.beginPath();
          q.moveTo(10, 9);
          q.lineTo(14, 7);
          q.lineTo(18, 9);
          q.lineTo(18, 12);
          q.lineTo(14, 14);
          q.lineTo(14, 18);
          q.strokePath();

          q.fillStyle(0x333366, 1);
          q.fillCircle(14, 22, 2);

          q.generateTexture("qblock28", 28, 28);
          q.destroy();
        }

        // Enemy (30x30)
        {
          const e = this.make.graphics({ x: 0, y: 0, add: false });
          e.fillStyle(0xff6666, 1);
          e.fillRoundedRect(0, 0, 30, 30, 10);
          e.fillStyle(0xffffff, 0.35);
          e.fillRoundedRect(6, 6, 10, 10, 6);
          e.lineStyle(2, 0x5a1f1f, 0.8);
          e.strokeRoundedRect(0, 0, 30, 30, 10);
          e.generateTexture("enemy30", 30, 30);
          e.destroy();
        }

        // Flag (18x200)
        {
          const f = this.make.graphics({ x: 0, y: 0, add: false });
          f.fillStyle(0x00ff66, 1);
          f.fillRoundedRect(0, 0, 18, 200, 8);
          f.lineStyle(2, 0x0a5a2a, 0.8);
          f.strokeRoundedRect(0, 0, 18, 200, 8);
          f.generateTexture("flag18x200", 18, 200);
          f.destroy();
        }
      }

      create() {
        const H = 540;
        const levelWidth = 3000;

        const s = session.settings || {};
        this.infiniteLives = (session.mode === "practice") ? true : !!s.infiniteLives;
        this.masteryAccuracy = Number(s.masteryAccuracy ?? 70);
        this.attemptsAllowed = Number(s.attemptsAllowed ?? 3);

        this.createProceduralTextures();

        this.cameras.main.setBackgroundColor("#0f1115");
        this.physics.world.setBounds(0, 0, levelWidth, H);

        // HUD
        this.hud = this.add.text(12, 10, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#fff"
        }).setScrollFactor(0);

        // Groups
        this.platforms = this.physics.add.staticGroup();
        this.coins = this.physics.add.staticGroup();
        this.qblocks = this.physics.add.staticGroup();
        this.flag = this.physics.add.staticGroup();

        // IMPORTANT: enemies as physics group for reliable movement/collisions
        this.enemies = this.physics.add.group({ allowGravity: true, immovable: false });

        // Ground tiles
        for (let x = 0; x < levelWidth; x += 64) {
          const ground = this.add.image(x + 32, H - 18, "platform64");
          this.physics.add.existing(ground, true);
          this.platforms.add(ground);
        }

        // Floating platforms
        this.addPlatform(380, 380, 180);
        this.addPlatform(780, 320, 220);
        this.addPlatform(1260, 360, 220);
        this.addPlatform(1700, 320, 260);
        this.addPlatform(2200, 360, 220);

        // Player
        this.player = this.physics.add.image(80, H - 90, "cellPlayer");
        this.player.setCollideWorldBounds(true);
        this.player.body.setGravityY(800);
        this.player.body.setSize(28, 34, true);

        // Coins
        this.spawnCoin(220, H - 90);
        this.spawnCoin(420, 340);
        this.spawnCoin(820, 280);
        this.spawnCoin(1760, 280);

        // Enemies
        this.spawnEnemy(520, H - 80);
        this.spawnEnemy(980, H - 80);
        this.spawnEnemy(1500, H - 80);

        // Q-blocks
        this.spawnQBlock(320, 300, "qb1");
        this.spawnQBlock(1100, 300, "qb2");
        this.spawnQBlock(2050, 300, "qb3");

        // Flag
        const flagImg = this.add.image(levelWidth - 150, H - 120, "flag18x200");
        this.physics.add.existing(flagImg, true);
        this.flag.add(flagImg);

        // Colliders
        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.enemies, this.platforms);

        // Q-blocks should be SOLID (stand on them, hit sides)
        // Trigger questions only when hit from below
        this.physics.add.collider(this.player, this.qblocks, this.onQBlockCollide, null, this);

        // Optional: enemies also collide with Q-blocks
        this.physics.add.collider(this.enemies, this.qblocks);

        // Overlaps
        this.physics.add.overlap(this.player, this.coins, this.onCoin, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.onEnemy, null, this);
        this.physics.add.overlap(this.player, this.flag, this.onWin, null, this);

        // Camera
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, levelWidth, H);

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        this.levelStartMs = Date.now();
        this.updateHUD();
      }

      addPlatform(x, y, widthPx) {
        const segments = Math.max(1, Math.round(widthPx / 64));
        const totalW = segments * 64;

        for (let i = 0; i < segments; i++) {
          const img = this.add.image(x - totalW / 2 + 32 + i * 64, y, "platform64");
          this.physics.add.existing(img, true);
          this.platforms.add(img);
        }
      }

      spawnCoin(x, y) {
        const coin = this.add.image(x, y, "coin20");
        this.physics.add.existing(coin, true);
        this.coins.add(coin);
      }

      spawnEnemy(x, y) {
        const enemy = this.physics.add.image(x, y, "enemy30");
        enemy.body.setSize(26, 26, true);
        enemy.body.setGravityY(900);
        enemy.body.setCollideWorldBounds(true);

        // Force initial motion
        enemy.body.setVelocityX(-80);
        enemy.body.setMaxVelocity(200, 1000);

        this.enemies.add(enemy);
        return enemy;
      }

      spawnQBlock(x, y, id) {
        const qb = this.add.image(x, y, "qblock28");
        this.physics.add.existing(qb, true); // static solid body
        qb.qbId = id;
        qb.used = false;
        this.qblocks.add(qb);
      }

      update() {
        const left = this.cursors.left.isDown || this.keyA.isDown;
        const right = this.cursors.right.isDown || this.keyD.isDown;

        if (left) this.player.body.setVelocityX(-220);
        else if (right) this.player.body.setVelocityX(220);
        else this.player.body.setVelocityX(0);

        const onGround = this.player.body.blocked.down;
        if (this.cursors.up.isDown && onGround) this.player.body.setVelocityY(-560);

        // Enemy patrol and anti-stall
        this.enemies.children.iterate(e => {
          if (!e?.body) return;

          if (Math.abs(e.body.velocity.x) < 5) {
            e.body.setVelocityX(-80);
          }
          if (e.body.blocked.left || e.body.touching.left) e.body.setVelocityX(80);
          if (e.body.blocked.right || e.body.touching.right) e.body.setVelocityX(-80);
        });

        this.updateHUD();
      }

      onCoin(player, coin) {
        coin.destroy();
        this.score += 10;
      }

      onEnemy(player, enemy) {
        const playerFalling = player.body.velocity.y > 50;
        const playerAbove = player.y + 10 < enemy.y;

        if (playerFalling && playerAbove) {
          enemy.destroy();
          player.body.setVelocityY(-260);
          this.score += 25;
          return;
        }

        if (!this.infiniteLives) this.lives -= 1;

        player.body.setVelocityX(player.x < enemy.x ? -220 : 220);
        player.body.setVelocityY(-260);

        if (!this.infiniteLives && this.lives <= 0) {
          this.endAttempt(false, "out_of_lives");
        }
      }

      // Collider callback so Q-blocks are SOLID.
      // Trigger questions only when player hits the block from below.
      onQBlockCollide(player, qb) {
        if (qb.used) return;

        const hitFromBelow = player.body.touching.up && qb.body.touching.down;
        if (!hitFromBelow) return;

        qb.used = true;
        qb.setAlpha(0.55);

        const q = questionBank.questions[this.qIndex % questionBank.questions.length];
        this.qIndex++;

        const choiceText = q.choices.map((c, i) => `${i + 1}) ${c}`).join("\n");
        const raw = prompt(`${q.prompt}\n\n${choiceText}\n\nType 1-4:`);

        this.answered += 1;
        const idx = parseInt(raw, 10) - 1;

        if (idx === q.answerIndex) {
          this.correct += 1;
          this.score += 50;
          this.spawnCoin(qb.x, qb.y - 30);
        } else {
          this.spawnEnemy(qb.x + 40, qb.y - 20);
        }
      }

      onWin() {
        this.endAttempt(true, "completed");
      }

      endAttempt(completed, reason) {
        const ms = Date.now() - this.levelStartMs;
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);

        const result = {
          levelId: questionBank.levelId || "world1-1",
          completed,
          reason,
          score: this.score,
          answered: this.answered,
          correct: this.correct,
          accuracy,
          livesRemaining: this.infiniteLives ? null : this.lives,
          attempt: this.attempt,
          durationMs: ms,
          atISO: new Date().toISOString(),
          masteryMet: accuracy >= this.masteryAccuracy
        };

        BQ.writeResult(session.classCode, session.studentId, result);

        alert(
          `Level End\n\n` +
          `Completed: ${completed}\n` +
          `Accuracy: ${accuracy}% (Mastery: ${this.masteryAccuracy}%)\n` +
          `Score: ${this.score}\n` +
          `Answered: ${this.correct}/${this.answered}\n` +
          `Attempt: ${this.attempt}/${this.attemptsAllowed}\n`
        );

        if (session.mode === "assessment" && !result.masteryMet) {
          this.attempt += 1;
          if (this.attempt > this.attemptsAllowed) {
            this.scene.restart();
            return;
          }
        }

        this.scene.restart();
      }

      updateHUD() {
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);
        const lifeText = this.infiniteLives ? "∞" : String(this.lives);
        this.hud.setText(`Score ${this.score}   Lives ${lifeText}   Acc ${accuracy}%   Q ${this.correct}/${this.answered}`);
      }
    };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]));
  }
})();
