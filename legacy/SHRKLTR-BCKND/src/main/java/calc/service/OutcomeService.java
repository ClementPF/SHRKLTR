package calc.service;

import calc.DTO.GameDTO;
import calc.DTO.OutcomeDTO;
import calc.DTO.StatsDTO;
import calc.DTO.TournamentDTO;
import calc.ELO.EloRating;
import calc.entity.Outcome;
import calc.entity.Tournament;
import calc.repository.GameRepository;
import calc.repository.OutcomeRepository;
import calc.repository.UserRepository;
import org.modelmapper.ModelMapper;
import org.modelmapper.convention.MatchingStrategies;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Created by clementperez on 9/20/16.
 */
@Service
public class OutcomeService {

    @Autowired
    private OutcomeRepository outcomeRepository;
    @Autowired
    private GameService gameService;
    @Autowired
    private UserService userService;
    @Autowired
    private GameRepository gameRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private StatsService statsService;
    @Autowired
    private ModelMapper modelMapper;

    public List<OutcomeDTO> findByUserId(Long userId) {
        return outcomeRepository.findByUserId(userId).stream()
                .map(o -> convertToDto(o)).collect(Collectors.toList());
    }

    public List<OutcomeDTO> findByGameId(Long gameId) {
        return outcomeRepository.findByGameId(gameId).stream()
                .map(o -> convertToDto(o)).collect(Collectors.toList());

    }

    public List<OutcomeDTO> setOutcomesValueForTournament(List<OutcomeDTO> outcomeDTOs, TournamentDTO tournamentDTO) {
        double winnerSumScore = 0;
        double looserSumScore = 0;
        double tieSumScore = 0;

        for(OutcomeDTO o : outcomeDTOs){
            StatsDTO stats = statsService.findByUserNameAndTournament(o.getUser().getUsername(), tournamentDTO.getName());
            double score = stats != null ? stats.getScore() : 1000;
            if(o.isWin()){
                winnerSumScore += score;
            }else if(o.isLose()){
                looserSumScore += score;
            }else if(o.isTie()){
                tieSumScore += score;
            }
        }

        long winnersCount = outcomeDTOs.stream().filter(OutcomeDTO::isWin).count();
        long losersCount = outcomeDTOs.stream().filter(OutcomeDTO::isLose).count();

        double winnerMeanValue = winnerSumScore / winnersCount;//winnerStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();
        double looserMeanValue = looserSumScore / losersCount;//loserStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();
        //double tieMeanValue = tieSumScore / tiers.size();//tieStats.stream().flatMapToDouble(stats -> DoubleStream.of(stats.getScore())).average().getAsDouble();

        double pointValue = EloRating.calculatePointValue(
                winnerMeanValue,
                looserMeanValue,
                "+");

        for(OutcomeDTO o : outcomeDTOs){
            if(o.isWin()){
                o.setScoreValue(pointValue);
            }else if(o.isLose()){
                o.setScoreValue(-pointValue);
            }
        }

        return outcomeDTOs;
    }

    protected Outcome convertToEntity(OutcomeDTO outcomeDto) throws ParseException {
       // Outcome outcome = modelMapper.map(outcomeDto, Outcome.class);
       // modelMapper.getConfiguration().setMatchingStrategy(MatchingStrategies.LOOSE);

        Outcome outcome = null;

        outcome = new Outcome(
                outcomeDto.getScoreValue(),
                outcomeDto.getResult(),
                outcomeDto.getGameId() == null ? null : gameRepository.findOne(outcomeDto.getGameId()), //might no be created yet
                userService.convertToEntity(outcomeDto.getUser()));
        outcome.setOutcomeId(outcomeDto.getOutcomeId());

        return outcome;
    }

    protected OutcomeDTO convertToDto(Outcome outcome) {
        // OutcomeDTO outcomeDTO = modelMapper.map(outcome, OutcomeDTO.class);
        // modelMapper.getConfiguration().setMatchingStrategy(MatchingStrategies.LOOSE);

        OutcomeDTO outcomeDTO = new OutcomeDTO();

        outcomeDTO.setOutcomeId(outcome.getOutcomeId());
        outcomeDTO.setScoreValue(outcome.getScoreValue());
        outcomeDTO.setResult(outcome.getResults());
        outcomeDTO.setGameId(outcome.getGame().getGameId());
        outcomeDTO.setUser(userService.convertToDto(outcome.getUser()));

        return outcomeDTO;
    }
}

