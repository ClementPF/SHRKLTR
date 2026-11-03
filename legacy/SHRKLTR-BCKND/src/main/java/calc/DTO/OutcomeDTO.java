package calc.DTO;

import calc.entity.Game;
import calc.entity.Outcome;
import calc.entity.User;

import javax.persistence.JoinColumn;
import javax.persistence.ManyToOne;

/**
 * Created by clementperez on 10/2/16.
 */
public class OutcomeDTO {

    private Long outcomeId;
    private double scoreValue;
    private Outcome.Result result;
    private UserDTO user;
    private Long gameId;

    public OutcomeDTO() {
        super();
    }

    public OutcomeDTO(UserDTO user, Outcome.Result result, double score) {
        super();
        this.user = user;
        this.result = result;
        this.scoreValue = score;
    }

    public UserDTO getUser() {
        return user;
    }

    public void setUser(UserDTO user) {
        this.user = user;
    }

    public Long getOutcomeId() {
        return outcomeId;
    }

    public void setOutcomeId(Long outcomeId) {
        this.outcomeId = outcomeId;
    }

    public double getScoreValue() {
        return scoreValue;
    }

    public void setScoreValue(double scoreValue) {
        this.scoreValue = scoreValue;
    }

    public Outcome.Result getResult() {
        return result;
    }

    public void setResult(Outcome.Result result) {
        this.result = result;
    }

    public Long getGameId() {
        return gameId;
    }

    public void setGameId(Long gameId) {
        this.gameId = gameId;
    }

    public boolean isWin(){
        return this.result == Outcome.Result.WIN;
    }
    public boolean isLose(){
        return this.result == Outcome.Result.LOSS;
    }
    public boolean isTie(){
        return this.result == Outcome.Result.TIE;
    }
}
