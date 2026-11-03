package calc.DTO;

import calc.entity.Outcome;
import calc.entity.Tournament;
import calc.exception.APIException;

import javax.persistence.*;
import java.util.Date;
import java.util.List;
import java.util.Set;

/**
 * Created by clementperez on 10/2/16.
 */
public class GameDTO {

    private Long gameId;
    private Date date;
    private List<OutcomeDTO> outcomes;
    private TournamentDTO tournament;

    public GameDTO() {
        super();
    }

    public GameDTO(TournamentDTO t, List<OutcomeDTO> o) {
        super();
        this.outcomes = o;
        this.date = new Date();
        this.tournament = t;
    }

    public List<OutcomeDTO> getOutcomes() {
        return outcomes;
    }

    public void setOutcomes(List<OutcomeDTO> outcomes) {
        this.outcomes = outcomes;
    }

    public Date getDate() {
        return date;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public Long getGameId() {
        return gameId;
    }

    public void setGameId(Long gameId) {
        this.gameId = gameId;
    }

    public TournamentDTO getTournament() {
        return tournament;
    }

    public void setTournament(TournamentDTO tournament) {
        this.tournament = tournament;
    }
}
